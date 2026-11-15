from datetime import datetime
from sqlalchemy import BigInteger, Column, String, Boolean, DateTime, UUID, Text, ForeignKey, Integer, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, SCHEMA, USER_ID_FK


class UserOAuthIdentity(Base):
    """Link a user to an external OAuth provider (Google, Apple, etc.)"""
    __tablename__ = "user_oauth_identities"
    __table_args__ = (
        UniqueConstraint('provider', 'provider_subject', name='uq_oauth_provider_subject'),
        Index('ix_oauth_user_id', 'user_id'),
        {"schema": SCHEMA},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='CASCADE'), nullable=False)
    provider = Column(String(50), nullable=False)  # e.g. 'google', 'apple'
    provider_subject = Column(String(255), nullable=False)  # stable 'sub' claim from IdP
    email_at_link = Column(String(255), nullable=True)  # email used when identity was linked
    created_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


class EmailVerificationCode(Base):
    """Store email verification codes for user registration and email changes"""
    __tablename__ = "email_verification_codes"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='CASCADE'), nullable=False)
    code = Column(String(6), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


class PasswordResetCode(Base):
    """Store password reset codes"""
    __tablename__ = "password_reset_codes"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='CASCADE'), nullable=False)
    code = Column(String(6), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


class RefreshToken(Base):
    """Store refresh tokens for session management"""
    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='CASCADE'), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True)
    device_info = Column(JSON, default={})
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))
    last_used_at = Column(DateTime(timezone=True))

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


class PasswordHistory(Base):
    """Track password history to prevent reuse"""
    __tablename__ = "password_history"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='CASCADE'), nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


class PhoneVerificationRecord(Base):
    """Legacy/local audit of phone verification events (Twilio Verify is primary)."""
    __tablename__ = "phone_verification_records"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='CASCADE'), nullable=False)
    phone_number = Column(String(255), nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))

    user = relationship("User", foreign_keys=[user_id])


class LoginAttempt(Base):
    """Track login attempts for security monitoring"""
    __tablename__ = "login_attempts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete='SET NULL'), nullable=True)
    email = Column(String(255), nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    ip_address = Column(String(45))  # Deprecated: no longer set; use login_country/login_continent (GDPR)
    login_city = Column(String(100))     # City from GeoIP (GeoLite2-City) when available
    login_country = Column(String(10))   # ISO country from GeoIP
    login_continent = Column(String(10)) # Continent code from GeoIP
    user_agent = Column(Text)
    success = Column(Boolean, nullable=False)
    attempted_at = Column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'))
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=text('CURRENT_TIMESTAMP'))
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    organization = relationship("Organization", foreign_keys=[organization_id])
    user = relationship("User", foreign_keys=[user_id])