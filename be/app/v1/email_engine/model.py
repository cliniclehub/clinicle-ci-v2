"""
Email Engine Model
SQLAlchemy models for email queue and logs
"""

from sqlalchemy import BigInteger, Column, Text, String, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, ARRAY, JSONB, INET
from sqlalchemy.sql import text
from sqlalchemy.orm import relationship

from app.common.database_pool import Base
from app.common.schema_name import SCHEMA


class EmailQueue(Base):
    __tablename__ = "email_queue"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(UUID(as_uuid=True), nullable=False)
    template_id = Column(UUID(as_uuid=True), nullable=True)
    template_key = Column(String(100), nullable=True)
    to_emails = Column(ARRAY(String), nullable=False)  # Array of email addresses
    cc_emails = Column(ARRAY(String), nullable=True)  # Array of CC email addresses
    bcc_emails = Column(ARRAY(String), nullable=True)  # Array of BCC email addresses
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    body_text = Column(Text, nullable=True)
    from_name = Column(String(200), nullable=True)
    from_email = Column(String(200), nullable=False)
    reply_to = Column(String(200), nullable=True)
    template_data = Column(JSONB, nullable=True, server_default=text("'{}'::jsonb"))
    status = Column(String(50), default="pending", nullable=False)
    priority = Column(Integer, default=5, nullable=False)
    scheduled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=3, nullable=False)
    last_attempt_at = Column(TIMESTAMP(timezone=True), nullable=True)
    next_retry_at = Column(TIMESTAMP(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    error_details = Column(JSONB, nullable=True)
    sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
    provider_message_id = Column(String(500), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text('CURRENT_TIMESTAMP'), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text('CURRENT_TIMESTAMP'), nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    batch_name = Column(String(200), nullable=True)

    # Relationships - commented out to avoid import issues
    # organization = relationship("Organization")
    # template = relationship("EmailTemplate")
    # creator = relationship("User", foreign_keys=[created_by])

    # No additional constraints - using database defaults


class EmailLog(Base):
    __tablename__ = "email_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(UUID(as_uuid=True), nullable=False)
    queue_id = Column(BigInteger, ForeignKey(f"{SCHEMA}.email_queue.id", ondelete="SET NULL"), nullable=True)
    template_id = Column(UUID(as_uuid=True), nullable=True)
    template_key = Column(String(100), nullable=True)
    to_emails = Column(ARRAY(String), nullable=False)  # Array of email addresses
    cc_emails = Column(ARRAY(String), nullable=True)  # Array of CC email addresses
    bcc_emails = Column(ARRAY(String), nullable=True)  # Array of BCC email addresses
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=True)  # Rendered HTML content
    body_text = Column(Text, nullable=True)  # Rendered text content
    from_name = Column(String(200), nullable=True)
    from_email = Column(String(200), nullable=True)
    reply_to = Column(String(200), nullable=True)
    template_data = Column(JSONB, nullable=True)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(String(50), nullable=False)
    priority = Column(Integer, default=5, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=3, nullable=False)
    provider_message_id = Column(String(500), nullable=True)
    sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
    delivered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    opened_at = Column(TIMESTAMP(timezone=True), nullable=True)
    first_clicked_at = Column(TIMESTAMP(timezone=True), nullable=True)
    bounced_at = Column(TIMESTAMP(timezone=True), nullable=True)
    complained_at = Column(TIMESTAMP(timezone=True), nullable=True)
    open_count = Column(Integer, default=0, nullable=False)
    click_count = Column(Integer, default=0, nullable=False)
    bounce_type = Column(String(50), nullable=True)
    bounce_reason = Column(Text, nullable=True)
    complaint_feedback_type = Column(String(100), nullable=True)
    user_agent = Column(Text, nullable=True)
    ip_address = Column(INET, nullable=True)
    error_message = Column(Text, nullable=True)
    error_code = Column(String(100), nullable=True)
    error_details = Column(JSONB, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text('CURRENT_TIMESTAMP'), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text('CURRENT_TIMESTAMP'), nullable=False)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    batch_name = Column(String(200), nullable=True)

    # Relationships - commented out to avoid import issues
    # organization = relationship("Organization")
    # template = relationship("EmailTemplate")
    # sender = relationship("User", foreign_keys=[sent_by])

    # No additional constraints - using database defaults