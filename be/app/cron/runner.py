"""Execute a one-shot cron job with run logging."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from app.common.database_pool import get_db
import app.v1.models  # noqa: F401 — register all ORM mappers before any DB query
from app.v1.cron_jobs.constants import DISPATCH_JOB_ORDER, job_had_work
from app.v1.cron_jobs.services import CronJobRunService, CronJobSettingsService

JobFn = Callable[[], Awaitable[dict[str, Any]]]

JOB_REGISTRY: dict[str, JobFn] = {}


def register_job(name: str, fn: JobFn) -> None:
    JOB_REGISTRY[name] = fn


def is_job_due(
    last_success_at: datetime | None,
    interval_seconds: int,
    now: datetime | None = None,
) -> bool:
    if last_success_at is None:
        return True
    current = now or datetime.now(timezone.utc)
    return (current - last_success_at).total_seconds() >= interval_seconds


def get_due_jobs(db) -> tuple[list[str], list[str], list[str]]:
    """Return (due_job_names, skipped_job_names, disabled_job_names)."""
    settings_map = CronJobSettingsService.get_settings_map(db)
    due: list[str] = []
    skipped: list[str] = []
    disabled: list[str] = []
    now = datetime.now(timezone.utc)

    for job_name in DISPATCH_JOB_ORDER:
        if job_name not in JOB_REGISTRY:
            continue

        setting = settings_map.get(job_name)
        if setting and not setting.enabled:
            disabled.append(job_name)
            continue

        if CronJobRunService.has_running_job(db, job_name):
            skipped.append(job_name)
            continue

        interval = setting.interval_seconds if setting else 300
        # Use last finished run (any status) so a failing job is not retried every
        # dispatch tick (~5 min) while waiting for its configured interval.
        last_finished = CronJobRunService.get_last_finished_at(db, job_name)
        if is_job_due(last_finished, interval, now):
            due.append(job_name)
        else:
            skipped.append(job_name)

    return due, skipped, disabled


async def execute_job(
    job_name: str,
    *,
    trigger: str | None = None,
    bypass_enabled_check: bool = False,
) -> dict[str, Any]:
    """Run a registered job with cron_job_runs logging. Raises on failure."""
    if job_name not in JOB_REGISTRY:
        raise ValueError(f"Unknown cron job: {job_name}")

    if not bypass_enabled_check:
        db = next(get_db())
        try:
            settings_map = CronJobSettingsService.get_settings_map(db)
            setting = settings_map.get(job_name)
            if setting and not setting.enabled:
                return {"skipped": True, "reason": "disabled"}
        finally:
            db.close()

    from app.common.business_exceptions import ConflictError

    resolved_trigger = trigger or os.getenv("CRON_TRIGGER", "scheduled")
    db = next(get_db())
    run_id: int | None = None
    try:
        service = CronJobRunService(db)
        run_id = service.try_start_run(job_name, trigger=resolved_trigger)
        if run_id is None:
            raise ConflictError(f"Cron job '{job_name}' is already running")
        summary = await JOB_REGISTRY[job_name]()
        had_work = job_had_work(job_name, summary)
        service.finish_run(run_id, status="success", summary=summary, had_work=had_work)
        return summary
    except Exception as e:
        if run_id is not None:
            CronJobRunService(db).finish_run(
                run_id,
                status="failed",
                summary={},
                error_message=str(e),
                had_work=True,
            )
        raise
    finally:
        CronJobRunService.release_cron_job_lock(db, job_name)
        db.close()


async def trigger_manual_cron_job(job_name: str):
    """
    Run a job immediately for super-admin manual triggers.

    Writes a cron_job_runs row with trigger=manual.
    """
    from app.common.business_exceptions import NotFoundError, ValidationError
    from app.cron.registry import register_default_jobs
    from app.v1.cron_jobs.constants import CRON_JOB_DEFINITIONS

    if job_name not in CRON_JOB_DEFINITIONS:
        raise NotFoundError(f"Cron job {job_name} not found")

    register_default_jobs()
    try:
        await execute_job(job_name, trigger="manual", bypass_enabled_check=True)
    except Exception:
        # Failure is recorded on cron_job_runs; return that row to the caller.
        pass

    db = next(get_db())
    try:
        run = CronJobRunService.get_last_run(db, job_name)
        if not run or run.trigger != "manual":
            raise ValidationError("Cron job finished but no manual run record was found")
        detail = CronJobRunService.get_run(db, int(run.id))
        if not detail:
            raise ValidationError("Cron job finished but run detail could not be loaded")
        return detail
    finally:
        db.close()


async def dispatch_due_jobs() -> dict[str, Any]:
    """
    Run all jobs whose interval has elapsed since the last successful run.
    Intended for a single Render cron service on a 5-minute schedule.
    """
    db = next(get_db())
    try:
        due_jobs, skipped_jobs, disabled_jobs = get_due_jobs(db)
    finally:
        db.close()

    results: dict[str, Any] = {}
    failures: list[str] = []

    for job_name in due_jobs:
        try:
            summary = await execute_job(job_name)
            results[job_name] = {"status": "success", "summary": summary}
        except Exception as e:
            failures.append(job_name)
            results[job_name] = {"status": "failed", "error": str(e)}

    summary: dict[str, Any] = {
        "due_jobs": due_jobs,
        "skipped_jobs": skipped_jobs,
        "disabled_jobs": disabled_jobs,
        "failed_jobs": failures,
        "results": results,
    }
    if failures:
        raise RuntimeError(
            f"Dispatch completed with {len(failures)} failure(s): {', '.join(failures)}"
        )
    return summary
