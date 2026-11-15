from sqlalchemy import BigInteger, Boolean, Column, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, SCHEMA, USER_ID_FK


class NotificationRuleDefinition(Base):
    __tablename__ = "notification_rule_definitions"
    __table_args__ = {"schema": SCHEMA}

    rule_key = Column(Text, primary_key=True)
    display_name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(Text, nullable=False)
    default_channels = Column(JSONB, nullable=False, server_default=text("'[\"email\"]'::jsonb"))
    default_offsets_minutes = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    recipient_role = Column(Text, nullable=False, server_default=text("'user'"))
    is_time_based = Column(Boolean, nullable=False, server_default=text("true"))
    template_key = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=func.now(),
    )


class NotificationSchedule(Base):
    __tablename__ = "notification_schedules"
    __table_args__ = (
        Index("idx_notification_schedules_status_fire", "status", "fire_at"),
        Index("idx_notification_schedules_org_source", "organization_id", "source_type", "source_id"),
        {"schema": SCHEMA},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete="CASCADE"), nullable=True)
    rule_key = Column(
        Text,
        ForeignKey(f"{SCHEMA}.notification_rule_definitions.rule_key", ondelete="RESTRICT"),
        nullable=False,
    )
    fire_at = Column(TIMESTAMP(timezone=True), nullable=False)
    event_at = Column(TIMESTAMP(timezone=True), nullable=False)
    source_type = Column(Text, nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=False)
    source_hash = Column(Text, nullable=False)
    status = Column(Text, nullable=False, server_default=text("'pending'"))
    schedule_metadata = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    dispatched_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=func.now(),
    )

    rule = relationship("NotificationRuleDefinition")
    organization = relationship("Organization")
    user = relationship("User")


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "rule_key",
            "channel",
            "source_type",
            "source_id",
            "fire_at",
            name="uq_notification_deliveries_dedupe",
        ),
        Index("idx_notification_deliveries_org_rule", "organization_id", "rule_key"),
        Index("idx_notification_deliveries_status", "status"),
        {"schema": SCHEMA},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete="CASCADE"), nullable=False)
    rule_key = Column(
        Text,
        ForeignKey(f"{SCHEMA}.notification_rule_definitions.rule_key", ondelete="RESTRICT"),
        nullable=False,
    )
    channel = Column(String(32), nullable=False)
    source_type = Column(Text, nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=False)
    schedule_id = Column(
        BigInteger,
        ForeignKey(f"{SCHEMA}.notification_schedules.id", ondelete="SET NULL"),
        nullable=True,
    )
    fire_at = Column(TIMESTAMP(timezone=True), nullable=False)
    delivered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    status = Column(String(32), nullable=False)
    email_log_id = Column(BigInteger, nullable=True)
    error_message = Column(Text, nullable=True)
    delivery_metadata = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=func.now(),
    )

    rule = relationship("NotificationRuleDefinition")
    organization = relationship("Organization")
    user = relationship("User")
    schedule = relationship("NotificationSchedule")
