"""Cron run recovery coverage."""

from datetime import datetime, timedelta, timezone

import pytest

from app.v1.cron_jobs import services as cron_services
from app.v1.cron_jobs.model import CronJobRun
from app.v1.cron_jobs.services import CronJobRunService

pytestmark = pytest.mark.integration


def test_has_running_job_marks_stale_running_rows_failed(monkeypatch, db_session):
    monkeypatch.setattr(cron_services, "CRON_RUNNING_STALE_AFTER_SECONDS", 60)
    row = CronJobRun(
        job_name="email-queue",
        trigger="scheduled",
        status="running",
        started_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        summary={},
    )
    db_session.add(row)
    db_session.commit()

    assert CronJobRunService.has_running_job(db_session, "email-queue") is False

    db_session.refresh(row)
    assert row.status == "failed"
    assert row.finished_at is not None
    assert row.had_work is True
    assert row.summary["staleRunRecovered"] is True


def test_release_running_run_marks_row_failed(db_session):
    row = CronJobRun(
        job_name="email-queue",
        trigger="scheduled",
        status="running",
        summary={},
    )
    db_session.add(row)
    db_session.commit()

    released = CronJobRunService.release_running_run(db_session, int(row.id))

    db_session.refresh(row)
    assert released.status == "failed"
    assert row.status == "failed"
    assert row.finished_at is not None
    assert row.had_work is True
    assert row.summary["manualRelease"] is True
    assert "manually released" in (row.error_message or "")


def test_try_start_run_returns_none_when_job_already_running(db_session):
    row = CronJobRun(
        job_name="email-queue",
        trigger="scheduled",
        status="running",
        summary={},
    )
    db_session.add(row)
    db_session.commit()

    service = CronJobRunService(db_session)
    assert service.try_start_run("email-queue") is None
    assert (
        db_session.query(CronJobRun)
        .filter(CronJobRun.job_name == "email-queue", CronJobRun.status == "running")
        .count()
        == 1
    )


def test_try_start_run_blocks_second_session_until_lock_released(
    test_session_factory,
    test_engine,
):
    conn1 = test_engine.connect()
    trans1 = conn1.begin()
    sess1 = test_session_factory(bind=conn1)
    conn2 = test_engine.connect()
    trans2 = conn2.begin()
    sess2 = test_session_factory(bind=conn2)

    try:
        service1 = CronJobRunService(sess1)
        run_id = service1.try_start_run("email-queue", trigger="scheduled")
        assert run_id is not None

        service2 = CronJobRunService(sess2)
        assert service2.try_start_run("email-queue", trigger="scheduled") is None

        CronJobRunService.release_cron_job_lock(sess1, "email-queue")
        service1.finish_run(run_id, status="success", summary={}, had_work=False)

        run_id2 = service2.try_start_run("email-queue", trigger="scheduled")
        assert run_id2 is not None
        CronJobRunService.release_cron_job_lock(sess2, "email-queue")
        service2.finish_run(run_id2, status="success", summary={}, had_work=False)
    finally:
        sess1.close()
        sess2.close()
        trans1.rollback()
        trans2.rollback()
        conn1.close()
        conn2.close()


def test_prune_completed_runs_deletes_old_rows_and_keeps_running(db_session):
    old_success = CronJobRun(
        job_name="email-queue",
        trigger="scheduled",
        status="success",
        started_at=datetime.now(timezone.utc) - timedelta(days=45),
        finished_at=datetime.now(timezone.utc) - timedelta(days=45, minutes=-1),
        summary={},
    )
    recent_success = CronJobRun(
        job_name="email-queue",
        trigger="scheduled",
        status="success",
        started_at=datetime.now(timezone.utc) - timedelta(days=5),
        finished_at=datetime.now(timezone.utc) - timedelta(days=5, minutes=-1),
        summary={},
    )
    old_running = CronJobRun(
        job_name="hls-transcode",
        trigger="scheduled",
        status="running",
        started_at=datetime.now(timezone.utc) - timedelta(days=45),
        summary={},
    )
    db_session.add_all([old_success, recent_success, old_running])
    db_session.commit()
    old_success_id = old_success.id
    recent_success_id = recent_success.id
    old_running_id = old_running.id

    result = CronJobRunService.prune_completed_runs(db_session, retention_days=30)

    assert result.deleted_count == 1
    assert result.retention_days == 30
    assert result.preserved_latest_per_job == 1
    assert db_session.get(CronJobRun, old_success_id) is None
    assert db_session.get(CronJobRun, recent_success_id) is not None
    assert db_session.get(CronJobRun, old_running_id) is not None
