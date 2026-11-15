from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, SCHEMA


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", "organization_id", name="unique_email_per_org"),
        {"schema": SCHEMA},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email = Column(String(255), nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    password_hash = Column(String(255))
    email_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime(timezone=True))
    phone_number = Column(String(50), nullable=True)
    phone_verified = Column(Boolean, default=False, nullable=False)
    phone_verified_at = Column(DateTime(timezone=True), nullable=True)
    locked = Column(Boolean, default=False, nullable=False)
    locked_until = Column(DateTime(timezone=True))
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    last_successful_login_at = Column(DateTime(timezone=True), nullable=True)
    must_change_password = Column(Boolean, default=True, nullable=False)
    can_login = Column(Boolean, nullable=False, default=True)
    contact_email = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    organization = relationship("Organization", back_populates="users")
    roles = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")
    saved_filters = relationship("SavedFilter", back_populates="user", cascade="all, delete-orphan")
