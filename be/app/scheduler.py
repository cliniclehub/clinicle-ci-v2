"""Background schedulers and one-shot cron job runners."""

import asyncio
from typing import Any

from app.common.config import CRON_JOB_HISTORY_RETENTION_DAYS, SERVICE_NAME
from app.common.database_pool import get_db
from app.common.app_logger import get_logger
from app.v1.auth.services import Auth2Service
from app.v1.email_engine.services import EmailEngineService
from app.v1.notifications.services import NotificationDispatchService
from app.v1.organizations.model import Organization
from app.v1.cron_jobs.constants import (
    AUTH_CLEANUP_INTERVAL_SECONDS,
    CRON_HISTORY_CLEANUP_INTERVAL_SECONDS,
    EMAIL_QUEUE_INTERVAL_SECONDS,
    NOTIFICATION_DISPATCH_INTERVAL_SECONDS,
    NOTIFICATION_RECONCILE_INTERVAL_SECONDS,
)

logger = get_logger(__name__)


async def run_email_queue_once() -> dict[str, Any]:
    method_logger = logger.get_method_logger("run_email_queue_once")
    method_logger.info("Starting email queue processing")

    db = next(get_db())
    summary: dict[str, Any] = {
        "total_processed": 0,
        "organizations_checked": 0,
        "organization_errors": 0,
        "errors": [],
    }
    try:
        service = EmailEngineService(db)
        organizations = db.query(Organization).filter(Organization.is_active.is_(True)).all()
        summary["organizations_checked"] = len(organizations)

        for org in organizations:
            try:
                processed = service.process_email_queue(str(org.id), limit=50)
                summary["total_processed"] += processed
            except Exception as e:
                summary["organization_errors"] += 1
                summary["errors"].append(
                    {"organization_id": str(org.id), "organization_name": org.name, "error": str(e)}
                )
                method_logger.error(
                    f"Failed to process emails for organization {org.name}: {e!s}",
                    extra={"organization_id": str(org.id)},
                )
        return summary
    finally:
        db.close()


async def run_auth_cleanup_once() -> dict[str, Any]:
    method_logger = logger.get_method_logger("run_auth_cleanup_once")
    db = next(get_db())
    try:
        auth_service = Auth2Service(db)
        counts = await auth_service.cleanup_expired_sessions()
        method_logger.info("Auth data cleanup completed", extra=counts)
        return {"deleted": counts}
    finally:
        db.close()


async def run_notification_dispatch_once() -> dict[str, Any]:
    method_logger = logger.get_method_logger("run_notification_dispatch_once")
    db = next(get_db())
    try:
        summary = await NotificationDispatchService.dispatch_due(db)
        db.commit()
        method_logger.info("Notification dispatch completed", extra=summary)
        return summary
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def run_notification_reconcile_once() -> dict[str, Any]:
    method_logger = logger.get_method_logger("run_notification_reconcile_once")
    db = next(get_db())
    try:
        summary = await NotificationDispatchService.reconcile_upcoming(db)
        db.commit()
        method_logger.info("Notification schedule reconcile completed", extra=summary)
        return summary
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def run_cron_history_cleanup_once() -> dict[str, Any]:
    from app.v1.cron_jobs.services import CronJobRunService

    method_logger = logger.get_method_logger("run_cron_history_cleanup_once")
    db = next(get_db())
    try:
        result = CronJobRunService.prune_completed_runs(
            db,
            retention_days=CRON_JOB_HISTORY_RETENTION_DAYS,
        )
        summary = result.model_dump(mode="json")
        method_logger.info("Cron run history cleanup complete", extra=summary)
        return summary
    finally:
        db.close()


async def _loop_job(job_name: str, interval_seconds: int, initial_delay: int = 0):
    from app.cron.registry import register_default_jobs
    from app.cron.runner import execute_job

    register_default_jobs()
    method_logger = logger.get_method_logger(f"inline_{job_name}")
    if initial_delay:
        await asyncio.sleep(initial_delay)
    while True:
        try:
            await execute_job(job_name)
        except Exception as e:
            method_logger.error(f"Error in {job_name}: {e!s}")
        await asyncio.sleep(interval_seconds)


async def process_email_queue_scheduled():
    await _loop_job("email-queue", EMAIL_QUEUE_INTERVAL_SECONDS, initial_delay=300)


async def cleanup_expired_auth_data_scheduled():
    await _loop_job("auth-cleanup", AUTH_CLEANUP_INTERVAL_SECONDS, initial_delay=3600)


async def process_notification_dispatch_scheduled():
    await _loop_job("notification-dispatch", NOTIFICATION_DISPATCH_INTERVAL_SECONDS, initial_delay=300)


async def process_notification_reconcile_scheduled():
    await _loop_job("notification-reconcile", NOTIFICATION_RECONCILE_INTERVAL_SECONDS, initial_delay=600)


async def process_cron_history_cleanup_scheduled():
    await _loop_job(
        "cron-history-cleanup",
        CRON_HISTORY_CLEANUP_INTERVAL_SECONDS,
        initial_delay=CRON_HISTORY_CLEANUP_INTERVAL_SECONDS,
    )


def start_schedulers():
    logger.info("Starting background schedulers...", extra={"service_name": SERVICE_NAME})
    asyncio.create_task(process_email_queue_scheduled())
    asyncio.create_task(cleanup_expired_auth_data_scheduled())
    asyncio.create_task(process_notification_dispatch_scheduled())
    asyncio.create_task(process_notification_reconcile_scheduled())
    asyncio.create_task(process_cron_history_cleanup_scheduled())
    logger.info("All schedulers started successfully")
