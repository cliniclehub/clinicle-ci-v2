"""SQLAlchemy models for cron job settings and run history."""

from sqlalchemy import BigInteger, Boolean, Column, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.sql import text

from app.common.database_pool import Base
from app.common.schema_name import SCHEMA


class CronJobSetting(Base):
    __tablename__ = "cron_job_settings"
    __table_args__ = {"schema": SCHEMA}

    job_name = Column(String(64), primary_key=True)
    enabled = Column(Boolean, nullable=False, server_default=text("TRUE"))
    interval_seconds = Column(Integer, nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    updated_by = Column(UUID(as_uuid=True), nullable=True)


class CronJobRun(Base):
    __tablename__ = "cron_job_runs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_name = Column(String(64), nullable=False)
    trigger = Column(String(32), nullable=False, server_default=text("'scheduled'"))
    status = Column(String(32), nullable=False)
    started_at = Column(
        TIMESTAMP(timezone=True),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    finished_at = Column(TIMESTAMP(timezone=True), nullable=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True)
    summary = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error_message = Column(Text, nullable=True)
    host_metadata = Column(JSONB, nullable=True)
    had_work = Column(Boolean, nullable=True)
