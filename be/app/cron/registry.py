"""Register default cron jobs for CLI and manual API triggers."""

from __future__ import annotations

from app.cron.runner import JOB_REGISTRY, register_job
from app.scheduler import (
    run_auth_cleanup_once,
    run_cron_history_cleanup_once,
    run_email_queue_once,
    run_notification_dispatch_once,
    run_notification_reconcile_once,
)
from app.v1.cron_jobs.constants import DISPATCH_JOB_ORDER

_DEFAULT_JOBS = {
    "email-queue": run_email_queue_once,
    "auth-cleanup": run_auth_cleanup_once,
    "notification-dispatch": run_notification_dispatch_once,
    "notification-reconcile": run_notification_reconcile_once,
    "cron-history-cleanup": run_cron_history_cleanup_once,
}


def register_default_jobs() -> None:
    """Idempotent registration of all dispatch cron jobs."""
    for job_name in DISPATCH_JOB_ORDER:
        if job_name in JOB_REGISTRY:
            continue
        fn = _DEFAULT_JOBS.get(job_name)
        if fn is not None:
            register_job(job_name, fn)
