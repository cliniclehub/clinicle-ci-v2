"""Batch3: cover app.cron.runner due-job selection and execute/dispatch paths."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.common.business_exceptions import ConflictError
from app.cron import runner as cron_runner


def test_is_job_due_edge_cases():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    assert cron_runner.is_job_due(None, 300, now) is True
    assert cron_runner.is_job_due(now - timedelta(seconds=300), 300, now) is True
    assert cron_runner.is_job_due(now - timedelta(seconds=299), 300, now) is False


def test_get_due_jobs_classifies_disabled_running_due_skipped():
    cron_runner.JOB_REGISTRY.clear()
    cron_runner.register_job("job_a", lambda: None)
    cron_runner.register_job("job_b", lambda: None)
    cron_runner.register_job("job_c", lambda: None)

    settings = {
        "job_a": SimpleNamespace(enabled=False, interval_seconds=300),
        "job_b": SimpleNamespace(enabled=True, interval_seconds=300),
        "job_c": SimpleNamespace(enabled=True, interval_seconds=300),
    }
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    db = MagicMock()

    with (
        patch("app.cron.runner.DISPATCH_JOB_ORDER", ["job_a", "job_b", "job_c", "missing"]),
        patch(
            "app.cron.runner.CronJobSettingsService.get_settings_map",
            return_value=settings,
        ),
        patch(
            "app.cron.runner.CronJobRunService.has_running_job",
            side_effect=lambda _db, name: name == "job_b",
        ),
        patch(
            "app.cron.runner.CronJobRunService.get_last_finished_at",
            return_value=now - timedelta(seconds=400),
        ),
        patch("app.cron.runner.datetime") as dt,
    ):
        dt.now.return_value = now
        dt.side_effect = lambda *a, **k: datetime(*a, **k)
        due, skipped, disabled = cron_runner.get_due_jobs(db)

    assert "job_a" in disabled
    assert "job_b" in skipped
    assert "job_c" in due


@pytest.mark.asyncio
async def test_execute_job_unknown_disabled_conflict_success_failure():
    cron_runner.JOB_REGISTRY.clear()

    with pytest.raises(ValueError, match="Unknown"):
        await cron_runner.execute_job("nope")

    async def _ok():
        return {"processed": 1}

    cron_runner.register_job("ok_job", _ok)

    db_settings = MagicMock()
    db_settings.close = MagicMock()
    with (
        patch("app.cron.runner.get_db", return_value=iter([db_settings])),
        patch(
            "app.cron.runner.CronJobSettingsService.get_settings_map",
            return_value={"ok_job": SimpleNamespace(enabled=False, interval_seconds=60)},
        ),
    ):
        skipped = await cron_runner.execute_job("ok_job")
    assert skipped == {"skipped": True, "reason": "disabled"}

    run_db = MagicMock()
    run_db.close = MagicMock()
    service = MagicMock()
    service.try_start_run.return_value = None

    with (
        patch("app.cron.runner.get_db", return_value=iter([run_db])),
        patch("app.cron.runner.CronJobRunService", return_value=service),
        patch("app.cron.runner.CronJobRunService.release_cron_job_lock"),
    ):
        with pytest.raises(ConflictError):
            await cron_runner.execute_job("ok_job", bypass_enabled_check=True)

    service.try_start_run.return_value = 42
    service.finish_run = MagicMock()
    run_db2 = MagicMock()
    with (
        patch("app.cron.runner.get_db", return_value=iter([run_db2])),
        patch("app.cron.runner.CronJobRunService", return_value=service),
        patch("app.cron.runner.CronJobRunService.release_cron_job_lock"),
        patch("app.cron.runner.job_had_work", return_value=True),
    ):
        summary = await cron_runner.execute_job("ok_job", bypass_enabled_check=True)
    assert summary == {"processed": 1}
    service.finish_run.assert_called()

    async def _boom():
        raise RuntimeError("boom")

    cron_runner.JOB_REGISTRY["ok_job"] = _boom
    service.try_start_run.return_value = 7
    run_db3 = MagicMock()
    with (
        patch("app.cron.runner.get_db", return_value=iter([run_db3])),
        patch("app.cron.runner.CronJobRunService", return_value=service),
        patch("app.cron.runner.CronJobRunService.release_cron_job_lock"),
    ):
        with pytest.raises(RuntimeError, match="boom"):
            await cron_runner.execute_job("ok_job", bypass_enabled_check=True)


@pytest.mark.asyncio
async def test_dispatch_due_jobs_success_and_failure_summary():
    cron_runner.JOB_REGISTRY.clear()

    async def _ok():
        return {"n": 1}

    async def _bad():
        raise RuntimeError("fail")

    cron_runner.register_job("good", _ok)
    cron_runner.register_job("bad", _bad)

    db = MagicMock()
    db.close = MagicMock()
    with (
        patch("app.cron.runner.get_db", return_value=iter([db])),
        patch(
            "app.cron.runner.get_due_jobs",
            return_value=(["good", "bad"], ["skip"], ["off"]),
        ),
        patch(
            "app.cron.runner.execute_job",
            side_effect=[
                {"n": 1},
                RuntimeError("fail"),
            ],
        ),
    ):
        with pytest.raises(RuntimeError, match="failure"):
            await cron_runner.dispatch_due_jobs()

    with (
        patch("app.cron.runner.get_db", return_value=iter([db])),
        patch(
            "app.cron.runner.get_due_jobs",
            return_value=(["good"], [], []),
        ),
        patch("app.cron.runner.execute_job", return_value={"n": 1}),
    ):
        summary = await cron_runner.dispatch_due_jobs()
    assert summary["due_jobs"] == ["good"]
    assert summary["failed_jobs"] == []
    assert summary["results"]["good"]["status"] == "success"
