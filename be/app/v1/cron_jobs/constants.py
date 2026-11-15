"""Cron job metadata and default intervals."""

from __future__ import annotations

from typing import Any

EMAIL_QUEUE_INTERVAL_SECONDS = 300
AUTH_CLEANUP_INTERVAL_SECONDS = 3600
NOTIFICATION_DISPATCH_INTERVAL_SECONDS = 300
NOTIFICATION_RECONCILE_INTERVAL_SECONDS = 86400
CRON_HISTORY_CLEANUP_INTERVAL_SECONDS = 86400

DISPATCH_TICK_SECONDS = 300

CRON_JOB_DEFINITIONS: dict[str, dict[str, Any]] = {
    "email-queue": {
        "display_name": "Email queue",
        "description": "Sends queued transactional emails (up to 50 per org per run).",
        "default_interval_seconds": EMAIL_QUEUE_INTERVAL_SECONDS,
    },
    "auth-cleanup": {
        "display_name": "Auth cleanup",
        "description": "Deletes expired auth codes, refresh tokens, and old login attempts.",
        "default_interval_seconds": AUTH_CLEANUP_INTERVAL_SECONDS,
    },
    "notification-dispatch": {
        "display_name": "Notification dispatch",
        "description": "Sends due scheduled notification emails.",
        "default_interval_seconds": NOTIFICATION_DISPATCH_INTERVAL_SECONDS,
    },
    "notification-reconcile": {
        "display_name": "Notification reconcile",
        "description": "Rebuilds upcoming notification schedules from active rules.",
        "default_interval_seconds": NOTIFICATION_RECONCILE_INTERVAL_SECONDS,
    },
    "cron-history-cleanup": {
        "display_name": "Cron history cleanup",
        "description": "Deletes completed cron run history older than the configured retention window.",
        "default_interval_seconds": CRON_HISTORY_CLEANUP_INTERVAL_SECONDS,
    },
}

DISPATCH_JOB_ORDER: tuple[str, ...] = tuple(CRON_JOB_DEFINITIONS.keys())


def job_had_work(job_name: str, summary: dict[str, Any]) -> bool:
    if not summary:
        return False

    if job_name == "email-queue":
        return (summary.get("total_processed") or 0) > 0 or (summary.get("organization_errors") or 0) > 0

    if job_name == "auth-cleanup":
        deleted = summary.get("deleted") or {}
        return sum(int(v or 0) for v in deleted.values()) > 0

    if job_name == "notification-dispatch":
        return (
            (summary.get("processed_schedules") or 0) > 0
            or (summary.get("sent") or 0) > 0
            or (summary.get("failed") or 0) > 0
            or bool(summary.get("errors"))
        )

    if job_name == "notification-reconcile":
        return (summary.get("schedules_created") or 0) > 0 or bool(summary.get("errors"))

    if job_name == "cron-history-cleanup":
        return (summary.get("deleted_count") or 0) > 0

    return True
