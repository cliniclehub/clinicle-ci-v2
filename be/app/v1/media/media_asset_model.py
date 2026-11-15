"""SQLAlchemy model for tenant media object tracking."""

import uuid

from sqlalchemy import BigInteger, CheckConstraint, Column, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.sql import text

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, SCHEMA, USER_ID_FK


class MediaAsset(Base):
    __tablename__ = "media_assets"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "source_object_key",
            name="uq_media_assets_org_source_object_key",
        ),
        CheckConstraint(
            "media_type IN ('video', 'audio', 'pdf', 'document', 'image', 'other')",
            name="ck_media_assets_media_type",
        ),
        CheckConstraint(
            "status IN ('uploaded', 'ready', 'failed')",
            name="ck_media_assets_status",
        ),
        {"schema": SCHEMA},
    )

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    source_object_key = Column(Text, nullable=False)
    display_name = Column(Text, nullable=True)
    media_type = Column(String(32), nullable=False, server_default=text("'other'"))
    source_mime_type = Column(String(255), nullable=True)
    source_size_bytes = Column(BigInteger, nullable=True)
    status = Column(String(32), nullable=False, server_default=text("'uploaded'"))
    created_by = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
