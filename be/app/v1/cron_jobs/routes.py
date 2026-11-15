"""Cron job settings and run history API (super-admin only)."""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.api_response_schema import SuccessMessages, paginated_response, success_response
from app.common.auth_helper import UserTokenInfo, assert_permission, get_current_user
from app.common.business_exceptions import NotFoundError, ValidationError
from app.common.database_pool import get_db
from app.v1.auth.permissions import PLATFORM_SETTINGS_MANAGE
from app.v1.cron_jobs.constants import CRON_JOB_DEFINITIONS
from app.v1.cron_jobs.schema import CronJobRunPruneRequest, CronJobSettingUpdate
from app.v1.cron_jobs.services import CronJobRunService, CronJobSettingsService

router = APIRouter(prefix="/cron-jobs", tags=["cron-jobs"])


def _require_cron_admin(current_user: UserTokenInfo) -> None:
    assert_permission(current_user, PLATFORM_SETTINGS_MANAGE)


@router.get("/settings")
async def list_cron_job_settings(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_cron_admin(current_user)
    settings = CronJobSettingsService.list_settings(db)
    return success_response(data=settings, message=SuccessMessages.LISTED)


@router.patch("/settings/{job_name}")
async def update_cron_job_setting(
    job_name: str,
    body: CronJobSettingUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_cron_admin(current_user)
    if job_name not in CRON_JOB_DEFINITIONS:
        raise NotFoundError(f"Cron job {job_name} not found")

    if body.enabled is None and body.interval_seconds is None:
        raise ValidationError("Provide enabled and/or intervalSeconds to update")

    try:
        updated = CronJobSettingsService.update_setting(
            db,
            job_name,
            enabled=body.enabled,
            interval_seconds=body.interval_seconds,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise NotFoundError(str(e)) from e

    return success_response(data=updated, message=SuccessMessages.UPDATED)


@router.get("/runs")
async def list_cron_job_runs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    job_name: Optional[str] = Query(None, description="Filter by job name"),
    status: Optional[str] = Query(None, description="Filter by status (running, success, failed)"),
    started_after: Optional[datetime] = Query(None, description="Runs started on or after (ISO 8601)"),
    started_before: Optional[datetime] = Query(None, description="Runs started on or before (ISO 8601)"),
    exclude_idle: bool = Query(
        False,
        description="Hide successful runs that did no meaningful work",
    ),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_cron_admin(current_user)

    skip = (page - 1) * page_size
    runs, total = CronJobRunService.list_runs(
        db,
        skip=skip,
        limit=page_size,
        job_name=job_name,
        status=status,
        started_after=started_after,
        started_before=started_before,
        exclude_idle=exclude_idle,
    )
    return paginated_response(
        data=runs,
        total=total,
        page=page,
        limit=page_size,
        message=SuccessMessages.LISTED,
    )


@router.get("/runs/{run_id}")
async def get_cron_job_run(
    run_id: int,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_cron_admin(current_user)

    run = CronJobRunService.get_run(db, run_id)
    if not run:
        raise NotFoundError(f"Cron job run {run_id} not found")

    return success_response(data=run, message=SuccessMessages.RETRIEVED)


@router.post("/runs/prune")
async def prune_cron_job_runs(
    body: CronJobRunPruneRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Delete completed cron run history older than retentionDays (super-admin).

    Running rows are intentionally preserved so active jobs remain visible.
    """
    _require_cron_admin(current_user)
    result = CronJobRunService.prune_completed_runs(
        db,
        retention_days=body.retention_days,
    )
    return success_response(data=result, message=SuccessMessages.DELETED)


@router.post("/runs/{run_id}/release")
async def release_cron_job_run(
    run_id: int,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Manually release a run left in running state (super-admin).

    This does not kill an operating-system process. It marks the run failed so
    the dispatcher can schedule that job again.
    """
    _require_cron_admin(current_user)
    run = CronJobRunService.release_running_run(
        db,
        run_id,
        released_by=current_user.id,
    )
    return success_response(data=run, message=SuccessMessages.UPDATED)


@router.post("/jobs/{job_name}/run")
async def run_cron_job_now(
    job_name: str,
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """
    Manually run a cron job off-cycle (super-admin).

    Uses the same job implementations as Render Cron and writes to cron_job_runs
    with trigger=manual.
    """
    _require_cron_admin(current_user)

    from app.cron.runner import trigger_manual_cron_job

    try:
        run = await trigger_manual_cron_job(job_name)
    except Exception as exc:
        from app.common.business_exceptions import AppError, ValidationError

        if isinstance(exc, AppError):
            raise
        raise ValidationError(str(exc)) from exc

    message = (
        SuccessMessages.CREATED
        if run.status == "success"
        else "Cron job run completed with errors"
    )
    return success_response(data=run, message=message)
