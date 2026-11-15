"""Cron job settings, run logging, and query service."""

from __future__ import annotations

import hashlib
import os
import socket
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.common.business_exceptions import NotFoundError, ValidationError
from app.common.config import CRON_RUNNING_STALE_AFTER_SECONDS
from app.v1.cron_jobs.constants import CRON_JOB_DEFINITIONS, DISPATCH_JOB_ORDER, job_had_work
from app.v1.cron_jobs.model import CronJobRun, CronJobSetting
from app.v1.cron_jobs.schema import (
    CronJobRunDetail,
    CronJobRunPruneResult,
    CronJobRunSummary,
    CronJobSettingDetail,
)


def _host_metadata() -> dict[str, Any]:
    return {
        "hostname": socket.gethostname(),
        "service_name": os.getenv("SERVICE_NAME", "platform-api"),
        "render_service_id": os.getenv("RENDER_SERVICE_ID"),
    }


class CronJobSettingsService:
    @staticmethod
    def ensure_defaults(db: Session) -> None:
        existing = {row.job_name for row in db.query(CronJobSetting.job_name).all()}
        for job_name, meta in CRON_JOB_DEFINITIONS.items():
            if job_name in existing:
                continue
            db.add(
                CronJobSetting(
                    job_name=job_name,
                    enabled=True,
                    interval_seconds=int(meta["default_interval_seconds"]),
                    description=str(meta.get("description") or ""),
                )
            )
        db.commit()

    @staticmethod
    def list_settings(db: Session) -> list[CronJobSettingDetail]:
        CronJobSettingsService.ensure_defaults(db)
        rows = (
            db.query(CronJobSetting)
            .filter(CronJobSetting.job_name.in_(DISPATCH_JOB_ORDER))
            .all()
        )
        rows_by_name = {row.job_name: row for row in rows}
        result: list[CronJobSettingDetail] = []
        for job_name in DISPATCH_JOB_ORDER:
            row = rows_by_name.get(job_name)
            if not row:
                continue
            last_success = CronJobRunService.get_last_successful_finished_at(db, job_name)
            last_finished = CronJobRunService.get_last_finished_at(db, job_name)
            last_run = CronJobRunService.get_last_run(db, job_name)
            result.append(
                CronJobSettingDetail.from_row(
                    job_name=row.job_name,
                    enabled=row.enabled,
                    interval_seconds=row.interval_seconds,
                    description=row.description,
                    updated_at=row.updated_at,
                    updated_by=row.updated_by,
                    last_success_at=last_success,
                    last_finished_at=last_finished,
                    last_run_at=last_run.started_at if last_run else None,
                    last_run_status=last_run.status if last_run else None,
                    last_had_work=last_run.had_work if last_run else None,
                )
            )
        return result

    @staticmethod
    def get_settings_map(db: Session) -> dict[str, CronJobSetting]:
        CronJobSettingsService.ensure_defaults(db)
        rows = db.query(CronJobSetting).all()
        return {row.job_name: row for row in rows}

    @staticmethod
    def update_setting(
        db: Session,
        job_name: str,
        *,
        enabled: Optional[bool] = None,
        interval_seconds: Optional[int] = None,
        updated_by: Optional[UUID] = None,
    ) -> CronJobSettingDetail:
        if job_name not in CRON_JOB_DEFINITIONS:
            raise ValueError(f"Unknown cron job: {job_name}")

        CronJobSettingsService.ensure_defaults(db)
        row = db.query(CronJobSetting).filter(CronJobSetting.job_name == job_name).first()
        if not row:
            raise ValueError(f"Cron job setting not found: {job_name}")

        if enabled is not None:
            row.enabled = enabled
        if interval_seconds is not None:
            row.interval_seconds = interval_seconds
        row.updated_at = datetime.now(timezone.utc)
        row.updated_by = updated_by
        db.commit()
        db.refresh(row)

        last_success = CronJobRunService.get_last_successful_finished_at(db, job_name)
        last_finished = CronJobRunService.get_last_finished_at(db, job_name)
        last_run = CronJobRunService.get_last_run(db, job_name)
        return CronJobSettingDetail.from_row(
            job_name=row.job_name,
            enabled=row.enabled,
            interval_seconds=row.interval_seconds,
            description=row.description,
            updated_at=row.updated_at,
            updated_by=row.updated_by,
            last_success_at=last_success,
            last_finished_at=last_finished,
            last_run_at=last_run.started_at if last_run else None,
            last_run_status=last_run.status if last_run else None,
            last_had_work=last_run.had_work if last_run else None,
        )


def _cron_job_lock_keys(job_name: str) -> tuple[int, int]:
    digest = hashlib.sha256(f"cron_job:{job_name}".encode("utf-8")).digest()
    k1 = int.from_bytes(digest[0:4], "big") & 0x7FFFFFFF
    k2 = int.from_bytes(digest[4:8], "big") & 0x7FFFFFFF
    return k1, k2


class CronJobRunService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def try_acquire_cron_job_lock(db: Session, job_name: str) -> bool:
        k1, k2 = _cron_job_lock_keys(job_name)
        acquired = db.execute(
            text("SELECT pg_try_advisory_lock(:k1, :k2)"),
            {"k1": k1, "k2": k2},
        ).scalar()
        return bool(acquired)

    @staticmethod
    def release_cron_job_lock(db: Session, job_name: str) -> None:
        k1, k2 = _cron_job_lock_keys(job_name)
        db.execute(text("SELECT pg_advisory_unlock(:k1, :k2)"), {"k1": k1, "k2": k2})

    def start_run(
        self,
        job_name: str,
        trigger: str = "scheduled",
        organization_id: Optional[str] = None,
    ) -> int:
        row = CronJobRun(
            job_name=job_name,
            trigger=trigger,
            status="running",
            organization_id=organization_id,
            summary={},
            host_metadata=_host_metadata(),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return int(row.id)

    def try_start_run(
        self,
        job_name: str,
        trigger: str = "scheduled",
        organization_id: Optional[str] = None,
    ) -> Optional[int]:
        """
        Acquire a per-job advisory lock, recover stale running rows, and insert a run row.

        Returns None when another worker holds the lock or a non-stale running row exists.
        """
        if not self.try_acquire_cron_job_lock(self.db, job_name):
            return None

        try:
            self.mark_stale_running_jobs_failed(self.db, job_name)
            if self._has_running_job_row(self.db, job_name):
                self.release_cron_job_lock(self.db, job_name)
                return None
            return self.start_run(job_name, trigger=trigger, organization_id=organization_id)
        except Exception:
            self.release_cron_job_lock(self.db, job_name)
            raise

    def finish_run(
        self,
        run_id: int,
        status: str,
        summary: Optional[dict[str, Any]] = None,
        error_message: Optional[str] = None,
        had_work: Optional[bool] = None,
    ) -> None:
        row = self.db.query(CronJobRun).filter(CronJobRun.id == run_id).first()
        if not row:
            return
        row.status = status
        row.finished_at = datetime.now(timezone.utc)
        row.summary = summary or {}
        row.error_message = error_message
        if had_work is not None:
            row.had_work = had_work
        self.db.commit()

    @staticmethod
    def list_runs(
        db: Session,
        skip: int,
        limit: int,
        job_name: Optional[str] = None,
        status: Optional[str] = None,
        started_after: Optional[datetime] = None,
        started_before: Optional[datetime] = None,
        exclude_idle: bool = False,
    ) -> tuple[list[CronJobRunSummary], int]:
        query = db.query(CronJobRun)
        if job_name:
            query = query.filter(CronJobRun.job_name == job_name)
        if status:
            query = query.filter(CronJobRun.status == status)
        if started_after:
            query = query.filter(CronJobRun.started_at >= started_after)
        if started_before:
            query = query.filter(CronJobRun.started_at <= started_before)
        if exclude_idle:
            query = query.filter(
                or_(
                    CronJobRun.status != "success",
                    CronJobRun.had_work.isnot(False),
                )
            )

        total = query.count()
        rows = query.order_by(CronJobRun.started_at.desc()).offset(skip).limit(limit).all()
        return [_to_summary(r) for r in rows], total

    @staticmethod
    def get_run(db: Session, run_id: int) -> Optional[CronJobRunDetail]:
        row = db.query(CronJobRun).filter(CronJobRun.id == run_id).first()
        if not row:
            return None
        return CronJobRunDetail.model_validate(_to_summary(row).model_dump())

    @staticmethod
    def release_running_run(
        db: Session,
        run_id: int,
        *,
        released_by: Optional[UUID] = None,
    ) -> CronJobRunDetail:
        row = db.query(CronJobRun).filter(CronJobRun.id == run_id).first()
        if not row:
            raise NotFoundError(f"Cron job run {run_id} not found")
        if row.status != "running":
            raise ValidationError(f"Cron job run {run_id} is not running")

        summary = dict(row.summary or {})
        summary.update(
            {
                "manualRelease": True,
                "releasedBy": str(released_by) if released_by else None,
                "releasedAt": datetime.now(timezone.utc).isoformat(),
            }
        )
        row.status = "failed"
        row.finished_at = datetime.now(timezone.utc)
        row.summary = summary
        row.error_message = (
            "Cron run manually released by a super admin. "
            "The underlying process may have already stopped or may still be finishing outside DB tracking."
        )
        row.had_work = True
        db.commit()
        db.refresh(row)
        return CronJobRunDetail.model_validate(_to_summary(row).model_dump())

    @staticmethod
    def prune_completed_runs(
        db: Session,
        *,
        retention_days: int,
    ) -> CronJobRunPruneResult:
        if retention_days < 0:
            raise ValidationError("retentionDays must be zero or greater")

        completed_filter = CronJobRun.status != "running"
        latest_completed_ids: list[int] = []
        job_names = [
            row[0]
            for row in db.query(CronJobRun.job_name).filter(completed_filter).distinct().all()
        ]
        for job_name in job_names:
            latest = (
                db.query(CronJobRun.id)
                .filter(completed_filter, CronJobRun.job_name == job_name)
                .order_by(
                    CronJobRun.finished_at.desc(),
                    CronJobRun.started_at.desc(),
                    CronJobRun.id.desc(),
                )
                .first()
            )
            if latest:
                latest_completed_ids.append(int(latest[0]))

        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        query = db.query(CronJobRun).filter(
            completed_filter,
            CronJobRun.started_at < cutoff,
        )
        if latest_completed_ids:
            query = query.filter(CronJobRun.id.notin_(latest_completed_ids))

        deleted_count = query.delete(synchronize_session=False)
        db.commit()
        return CronJobRunPruneResult(
            retention_days=retention_days,
            cutoff_at=cutoff,
            deleted_count=int(deleted_count or 0),
            preserved_latest_per_job=len(latest_completed_ids),
        )

    @staticmethod
    def get_last_successful_finished_at(db: Session, job_name: str) -> Optional[datetime]:
        row = (
            db.query(CronJobRun)
            .filter(CronJobRun.job_name == job_name, CronJobRun.status == "success")
            .order_by(CronJobRun.finished_at.desc())
            .first()
        )
        return row.finished_at if row and row.finished_at else None

    @staticmethod
    def get_last_finished_at(db: Session, job_name: str) -> Optional[datetime]:
        """Last completed run (success or failed) — used for dispatch interval spacing."""
        row = (
            db.query(CronJobRun)
            .filter(
                CronJobRun.job_name == job_name,
                CronJobRun.finished_at.isnot(None),
            )
            .order_by(CronJobRun.finished_at.desc())
            .first()
        )
        return row.finished_at if row else None

    @staticmethod
    def get_last_run(db: Session, job_name: str) -> Optional[CronJobRun]:
        return (
            db.query(CronJobRun)
            .filter(CronJobRun.job_name == job_name)
            .order_by(CronJobRun.started_at.desc())
            .first()
        )

    @staticmethod
    def _has_running_job_row(db: Session, job_name: str) -> bool:
        return (
            db.query(CronJobRun.id)
            .filter(CronJobRun.job_name == job_name, CronJobRun.status == "running")
            .first()
            is not None
        )

    @staticmethod
    def has_running_job(db: Session, job_name: str) -> bool:
        CronJobRunService.mark_stale_running_jobs_failed(db, job_name)
        return CronJobRunService._has_running_job_row(db, job_name)

    @staticmethod
    def mark_stale_running_jobs_failed(db: Session, job_name: str) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=CRON_RUNNING_STALE_AFTER_SECONDS)
        rows = (
            db.query(CronJobRun)
            .filter(
                CronJobRun.job_name == job_name,
                CronJobRun.status == "running",
                CronJobRun.started_at < cutoff,
            )
            .all()
        )
        if not rows:
            return 0

        now = datetime.now(timezone.utc)
        for row in rows:
            summary = dict(row.summary or {})
            summary.update(
                {
                    "staleRunRecovered": True,
                    "staleAfterSeconds": CRON_RUNNING_STALE_AFTER_SECONDS,
                }
            )
            row.status = "failed"
            row.finished_at = now
            row.summary = summary
            row.error_message = (
                f"Cron run marked failed after being left running for more than "
                f"{CRON_RUNNING_STALE_AFTER_SECONDS} seconds"
            )
            row.had_work = True
        db.commit()
        return len(rows)


def _to_summary(row: CronJobRun) -> CronJobRunSummary:
    summary = CronJobRunSummary.model_validate(row, from_attributes=True)
    if summary.had_work is None and summary.status == "success":
        return summary.model_copy(
            update={"had_work": job_had_work(summary.job_name, summary.summary)}
        )
    return summary
