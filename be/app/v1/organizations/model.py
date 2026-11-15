from sqlalchemy import Boolean, Column, DateTime, String, Text, UUID
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import text

from app.common.database_pool import Base
from app.common.schema_name import SCHEMA


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, unique=True)
    domain = Column(String(255), nullable=False, unique=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    logo_url = Column(String(200))
    favicon_url = Column(String(200))
    terms_of_use = Column(Text)
    privacy_policy = Column(Text)
    org_type = Column(String(50), nullable=True)
    code = Column(String(64))
    address_line1 = Column(String(255))
    address_line2 = Column(String(255))
    city = Column(String(128))
    state_province = Column(String(128))
    zip_postal = Column(String(32))
    country = Column(String(128))
    support_email = Column(String(255))
    info_email = Column(String(255))
    admin_email = Column(String(255))
    landing_page_html = Column(Text)
    site_theme = Column(JSONB, nullable=True)
    tracking_scripts = Column(JSONB, nullable=True)
    enforce_phone_validation = Column(Boolean, default=False)
    timezone = Column(String(64), nullable=False, server_default="UTC")
    notification_settings = Column(JSONB, nullable=True)

    users = relationship("User", back_populates="organization")
    user_roles = relationship("UserRole", back_populates="organization")
