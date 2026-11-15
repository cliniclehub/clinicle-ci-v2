"""SQLAlchemy model for email templates."""

from sqlalchemy import Boolean, Column, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.sql import text

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, SCHEMA, USER_ID_FK


class EmailTemplate(Base):
    __tablename__ = "email_templates"
    __table_args__ = (
        UniqueConstraint("organization_id", "template_key", name="unique_template_key_per_org"),
        {"schema": SCHEMA},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    template_key = Column(String(100), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    body_text = Column(Text, nullable=True)
    from_name = Column(String(200), nullable=True)
    from_email = Column(String(200), nullable=True)
    reply_to = Column(String(200), nullable=True)
    cc_emails = Column(Text, nullable=True)
    bcc_emails = Column(Text, nullable=True)
    category = Column(String(50), default="transactional", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_system_default = Column(Boolean, default=False, nullable=False)
    available_fields = Column(Text, nullable=True)
    preview_data = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete="SET NULL"), nullable=True)
    updated_by = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete="SET NULL"), nullable=True)
