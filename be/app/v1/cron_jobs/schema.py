"""Pydantic schemas for cron job settings and run API."""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import Field, field_validator

from app.common.base_schema import CamelModel
from app.v1.cron_jobs.constants import CRON_JOB_DEFINITIONS


class CronJobRunSummary(CamelModel):
    id: int
    job_name: str
    trigger: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    organization_id: Optional[UUID] = None
    summary: dict[str, Any] = {}
    error_message: Optional[str] = None
    host_metadata: Optional[dict[str, Any]] = None
    had_work: Optional[bool] = None

    @property
    def duration_seconds(self) -> Optional[float]:
        if self.finished_at and self.started_at:
            return (self.finished_at - self.started_at).total_seconds()
        return None


class CronJobRunDetail(CronJobRunSummary):
    """Full detail — same fields as list item for v1."""


class CronJobRunPruneRequest(CamelModel):
    retention_days: int = Field(default=30, ge=0, le=3650)


class CronJobRunPruneResult(CamelModel):
    retention_days: int
    cutoff_at: datetime
    deleted_count: int
    preserved_latest_per_job: int


class CronJobSettingUpdate(CamelModel):
    enabled: Optional[bool] = None
    interval_seconds: Optional[int] = Field(None, ge=60, le=7 * 24 * 3600)

    @field_validator("interval_seconds")
    @classmethod
    def round_interval(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        return int(value)


class CronJobSettingDetail(CamelModel):
    job_name: str
    display_name: str
    description: str
    enabled: bool
    interval_seconds: int
    updated_at: Optional[datetime] = None
    updated_by: Optional[UUID] = None
    last_success_at: Optional[datetime] = None
    last_finished_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_had_work: Optional[bool] = None
    next_due_at: Optional[datetime] = None

    @classmethod
    def from_row(
        cls,
        *,
        job_name: str,
        enabled: bool,
        interval_seconds: int,
        description: Optional[str],
        updated_at: Optional[datetime],
        updated_by: Optional[UUID],
        last_success_at: Optional[datetime],
        last_finished_at: Optional[datetime],
        last_run_at: Optional[datetime],
        last_run_status: Optional[str],
        last_had_work: Optional[bool],
    ) -> "CronJobSettingDetail":
        meta = CRON_JOB_DEFINITIONS.get(job_name, {})
        next_due_at = None
        if enabled and last_finished_at:
            from datetime import timedelta

            next_due_at = last_finished_at + timedelta(seconds=interval_seconds)

        return cls(
            job_name=job_name,
            display_name=str(meta.get("display_name") or job_name),
            description=description or str(meta.get("description") or ""),
            enabled=enabled,
            interval_seconds=interval_seconds,
            updated_at=updated_at,
            updated_by=updated_by,
            last_success_at=last_success_at,
            last_finished_at=last_finished_at,
            last_run_at=last_run_at,
            last_run_status=last_run_status,
            last_had_work=last_had_work,
            next_due_at=next_due_at,
        )
