"""Unit coverage for remaining scheduler run_*_once / loop / start paths."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app import scheduler


class _FakeDb:
    def __init__(self, orgs=None):
        self.closed = False
        self._orgs = orgs or []
        self.committed = False
        self.rolled_back = False

    def close(self):
        self.closed = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def query(self, model):
        q = MagicMock()
        q.filter.return_value = q
        name = getattr(model, "__name__", str(model))
        if "Organization" in name:
            q.all.return_value = self._orgs
        else:
            q.all.return_value = []
        return q


@pytest.mark.asyncio
async def test_run_email_queue_once_success_and_org_error(monkeypatch):
    org_ok = SimpleNamespace(id=uuid4(), name="Ok Org")
    org_bad = SimpleNamespace(id=uuid4(), name="Bad Org")
    db = _FakeDb(orgs=[org_ok, org_bad])

    class _Svc:
        def __init__(self, _db):
            pass

        def process_email_queue(self, org_id, limit=50):
            if str(org_id) == str(org_bad.id):
                raise RuntimeError("smtp down")
            return 3

    monkeypatch.setattr(scheduler, "get_db", lambda: iter([db]))
    monkeypatch.setattr(scheduler, "EmailEngineService", _Svc)

    summary = await scheduler.run_email_queue_once()
    assert summary["total_processed"] == 3
    assert summary["organizations_checked"] == 2
    assert summary["organization_errors"] == 1
    assert db.closed is True


@pytest.mark.asyncio
async def test_run_auth_cleanup_once(monkeypatch):
    db = _FakeDb()

    class _Auth:
        def __init__(self, _db):
            pass

        async def cleanup_expired_sessions(self):
            return {"sessions": 2, "tokens": 1}

    monkeypatch.setattr(scheduler, "get_db", lambda: iter([db]))
    monkeypatch.setattr(scheduler, "Auth2Service", _Auth)
    out = await scheduler.run_auth_cleanup_once()
    assert out["deleted"]["sessions"] == 2
    assert db.closed is True


@pytest.mark.asyncio
async def test_run_notification_dispatch_and_reconcile(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(scheduler, "get_db", lambda: iter([db]))

    async def _dispatch(_db):
        return {
            "due_schedules": 1,
            "processed_schedules": 1,
            "sent": 1,
            "failed": 0,
        }

    monkeypatch.setattr(
        scheduler.NotificationDispatchService,
        "dispatch_due",
        _dispatch,
    )
    out = await scheduler.run_notification_dispatch_once()
    assert out["sent"] == 1
    assert db.committed is True

    db2 = _FakeDb()
    monkeypatch.setattr(scheduler, "get_db", lambda: iter([db2]))

    async def _boom(_db):
        raise RuntimeError("dispatch fail")

    monkeypatch.setattr(
        scheduler.NotificationDispatchService,
        "dispatch_due",
        _boom,
    )
    with pytest.raises(RuntimeError, match="dispatch fail"):
        await scheduler.run_notification_dispatch_once()
    assert db2.rolled_back is True

    db3 = _FakeDb()
    monkeypatch.setattr(scheduler, "get_db", lambda: iter([db3]))

    async def _reconcile(_db):
        return {
            "rules_checked": 2,
            "schedules_created": 1,
        }

    monkeypatch.setattr(
        scheduler.NotificationDispatchService,
        "reconcile_upcoming",
        _reconcile,
    )
    out3 = await scheduler.run_notification_reconcile_once()
    assert out3["rules_checked"] == 2
    assert db3.committed is True


@pytest.mark.asyncio
async def test_run_cron_history_cleanup(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(scheduler, "get_db", lambda: iter([db]))
    prune = SimpleNamespace(
        model_dump=lambda mode="json": {
            "retention_days": 30,
            "deleted_count": 9,
            "cutoff_at": "2026-01-01T00:00:00Z",
        }
    )
    with patch(
        "app.v1.cron_jobs.services.CronJobRunService.prune_completed_runs",
        return_value=prune,
    ):
        out = await scheduler.run_cron_history_cleanup_once()
    assert out["deleted_count"] == 9
    assert db.closed is True


@pytest.mark.asyncio
async def test_loop_job_and_scheduled_wrappers(monkeypatch):
    calls = {"n": 0}

    async def _exec(name):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        raise asyncio.CancelledError()

    sleep_calls = []

    async def _sleep(sec):
        sleep_calls.append(sec)
        if len(sleep_calls) >= 2:
            raise asyncio.CancelledError()

    with (
        patch("app.cron.registry.register_default_jobs"),
        patch("app.cron.runner.execute_job", _exec),
        patch("app.scheduler.asyncio.sleep", _sleep),
    ):
        with pytest.raises(asyncio.CancelledError):
            await scheduler._loop_job("email-queue", 60, initial_delay=10)

    assert sleep_calls[0] == 10
    assert calls["n"] >= 1

    seen = []

    async def _fake_loop(job_name, interval_seconds, initial_delay=0):
        seen.append((job_name, interval_seconds, initial_delay))

    monkeypatch.setattr(scheduler, "_loop_job", _fake_loop)
    await scheduler.process_email_queue_scheduled()
    await scheduler.cleanup_expired_auth_data_scheduled()
    await scheduler.process_notification_dispatch_scheduled()
    await scheduler.process_notification_reconcile_scheduled()
    await scheduler.process_cron_history_cleanup_scheduled()
    assert [s[0] for s in seen] == [
        "email-queue",
        "auth-cleanup",
        "notification-dispatch",
        "notification-reconcile",
        "cron-history-cleanup",
    ]


def test_start_schedulers_creates_tasks(monkeypatch):
    created = []

    def _create_task(coro):
        created.append(coro)
        if hasattr(coro, "close"):
            coro.close()
        return MagicMock()

    monkeypatch.setattr(scheduler.asyncio, "create_task", _create_task)
    scheduler.start_schedulers()
    assert len(created) == 5
