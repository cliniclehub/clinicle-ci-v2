"""Notification dispatch durable claim coverage."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

import app.v1.notifications.services as notification_services
from app.v1.notifications.services import NotificationDispatchService


class _FakeScheduleQuery:
    def __init__(self, schedule):
        self._schedule = schedule

    def options(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def with_for_update(self, **kwargs):
        assert kwargs.get("of") is not None, "must lock NotificationSchedule only"
        assert kwargs.get("skip_locked") is True
        return self

    def first(self):
        return self._schedule


def _schedule(*, status="pending", updated_at=None):
    return SimpleNamespace(
        id=1,
        status=status,
        updated_at=updated_at or datetime.now(timezone.utc),
        rule_key="assignment_due_reminder",
        organization_id=uuid4(),
        rule=None,
        organization=None,
        offering=None,
        content=None,
    )


@pytest.mark.unit
def test_claim_next_due_schedule_sets_processing():
    schedule = _schedule(status="pending")
    db = MagicMock()
    db.query.return_value = _FakeScheduleQuery(schedule)

    claimed = NotificationDispatchService.claim_next_due_schedule(db)

    assert claimed is schedule
    assert schedule.status == "processing"
    db.flush.assert_called_once()


@pytest.mark.unit
def test_claim_next_due_schedule_reclaims_stale_processing(monkeypatch):
    monkeypatch.setattr(
        notification_services,
        "NOTIFICATION_DISPATCH_PROCESSING_STALE_AFTER_SECONDS",
        60,
    )
    schedule = _schedule(
        status="processing",
        updated_at=datetime.now(timezone.utc) - timedelta(minutes=2),
    )
    db = MagicMock()
    db.query.return_value = _FakeScheduleQuery(schedule)

    claimed = NotificationDispatchService.claim_next_due_schedule(db)

    assert claimed is schedule
    assert schedule.status == "processing"
    db.flush.assert_called_once()
