"""Cron job_had_work and media usage helper coverage."""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import MagicMock

from app.v1.cron_jobs.constants import job_had_work
from app.v1.media import media_usage_service


def test_job_had_work_branches():
    assert job_had_work("email-queue", {}) is False
    assert job_had_work("email-queue", {"total_processed": 1}) is True
    assert job_had_work("email-queue", {"organization_errors": 2}) is True
    assert job_had_work("auth-cleanup", {"deleted": {"a": 0, "b": 0}}) is False
    assert job_had_work("auth-cleanup", {"deleted": {"a": 1}}) is True
    assert job_had_work("notification-dispatch", {"sent": 1}) is True
    assert job_had_work("notification-dispatch", {"errors": ["x"]}) is True
    assert job_had_work("notification-reconcile", {"schedules_created": 3}) is True
    assert job_had_work("cron-history-cleanup", {"deleted_count": 5}) is True
    assert job_had_work("unknown-job", {"anything": True}) is True
    assert job_had_work("email-queue", None) is False  # type: ignore[arg-type]


def test_media_usage_helpers():
    db = MagicMock()
    org_id = uuid4()
    assert media_usage_service.find_media_file_usages(
        db, organization_id=org_id, object_key="k", media_url="u"
    ) == []
    counts = media_usage_service.count_object_key_usages(
        db, organization_id=org_id, object_keys=["a", " ", "", 12]  # type: ignore[list-item]
    )
    assert counts == {"a": 0}
