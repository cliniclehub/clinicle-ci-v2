# auth.py
import bcrypt
from fastapi import Depends, Request
from fastapi.security.utils import get_authorization_scheme_param
from jose import jwt, JWTError
from uuid import UUID
from app.v1.users.model import User
from app.v1.organizations.model import Organization
from app.v1.roles.model import Role, UserRole
from app.v1.roles.permission_bootstrap import (
    ensure_permission_catalog,
    resolve_permission_keys_for_user_roles,
)
from app.v1.auth.model import RefreshToken
from app.common.database_pool import get_db
from sqlalchemy.orm import Session
from app.common.config import AUTH2_SECRET_KEY, AUTH2_ALGORITHM
from app.common.app_logger import get_logger
from app.common.business_exceptions import AuthenticationError, AuthorizationError
from app.v1.auth.schema import UserTokenInfo
from typing import List, Optional, Callable
import hashlib
from datetime import datetime, timezone

# Set up logger
logger = get_logger(__name__)

# ------------------------------
# Shared Password Utilities
# ------------------------------
# These utilities are shared between auth and user services to ensure
# consistent password hashing and verification across the application.
# Both services should import and use these functions instead of
# implementing their own password hashing logic.

def hash_password(password: str) -> str:
    """Hash password using bcrypt - shared utility for auth and user services"""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash - shared utility for auth and user services"""
    if not hashed_password:
        return False
    
    # Using Python's bcrypt for verification
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

# ------------------------------
# Authentication Helper
# ------------------------------

# Remove the old UserTokenInfo class and use UserTokenInfo instead
async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> UserTokenInfo:
    """Get current user from Auth2 JWT token"""
    try:
        method_logger = logger.get_method_logger("get_current_user_from_token")
        method_logger.debug("Auth2 token authentication start")
        
        # Get token from Authorization header
        authorization = request.headers.get("Authorization")
        if not authorization:
            raise AuthenticationError("Authentication token is required")
        
        scheme, token = get_authorization_scheme_param(authorization)
        if scheme.lower() != "bearer":
            raise AuthenticationError("Invalid authentication token format")
        
        if not token:
            raise AuthenticationError("Authentication token is required")
        
        # Decode and verify the JWT token
        try:
            payload = jwt.decode(
                token,
                AUTH2_SECRET_KEY,
                algorithms=[AUTH2_ALGORITHM]
            )
        except JWTError as e:
            method_logger.error(f"JWT decode failed: {e}")
            raise AuthenticationError("Invalid token")
        
        # Extract user ID from payload
        user_id = payload.get("sub")
        if not user_id:
            raise AuthenticationError("Invalid token: missing user ID")
        
        # Get user from database with relationships
        user = db.query(User).filter_by(id=UUID(user_id)).first()
        if not user:
            raise AuthenticationError("User not found")
        
        # Check if user is active
        if user.locked:
            raise AuthenticationError("User account is locked")
        
        # Check if session is still valid (not revoked)
        session_id = payload.get("session_id")
        if session_id:
            session = db.query(RefreshToken).filter_by(
                id=int(session_id),
                user_id=user.id
            ).first()
            
            if not session:
                method_logger.warning(
                    "Session not found for user_id=%s session_id=%s",
                    user.id,
                    session_id,
                )
                raise AuthenticationError("Session not found")
            
            if session.expires_at < datetime.now(timezone.utc):
                method_logger.warning(
                    "Expired session used by user_id=%s session_id=%s",
                    user.id,
                    session_id,
                )
                raise AuthenticationError("Session has expired")
            
            if session.revoked:
                method_logger.warning(
                    "Revoked session used by user_id=%s session_id=%s",
                    user.id,
                    session_id,
                )
                raise AuthenticationError("Session has been revoked")
        
        # Get organization
        org = db.query(Organization).filter_by(id=user.organization_id).first()
        if not org or not org.is_active:
            raise AuthenticationError("Organization is inactive")
        
        # Get roles
        user_roles = db.query(Role).join(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.organization_id == user.organization_id
        ).all()

        ensure_permission_catalog(db)
        permission_keys = resolve_permission_keys_for_user_roles(db, user_roles)
        
        # Create unified UserTokenInfo object
        user_info = UserTokenInfo(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            organization_id=user.organization_id,
            organization_name=org.name if org else "",
            organization_domain=org.domain if org else "",
            roles=[role.key for role in user_roles],
            permissions=permission_keys,
            email_verified=user.email_verified,
            email_verified_at=user.email_verified_at,
            must_change_password=user.must_change_password,
            locked=user.locked,
            session_id=payload.get("session_id"),
            created_at=user.created_at,
            updated_at=user.updated_at
        )
        
        method_logger.debug("Auth2 authentication successful user_id=%s", user.id)
        return user_info
        
    except AuthenticationError:
        # Re-raise AuthenticationError as-is
        raise
    except Exception as e:
        method_logger.error("Auth2 authentication failed: %s", str(e))
        raise AuthenticationError("Authentication failed")

async def require_super_admin(
    current_user: UserTokenInfo = Depends(get_current_user),
) -> UserTokenInfo:
    if not current_user.has_any_role(["super_admin"]):
        raise AuthorizationError("You are not authorized to access this resource")
    return current_user


def require_permission(*permission_keys: str) -> Callable:
    """FastAPI dependency factory: user must have all listed permissions."""

    async def _dependency(
        current_user: UserTokenInfo = Depends(get_current_user),
    ) -> UserTokenInfo:
        missing = [k for k in permission_keys if not current_user.has_permission(k)]
        if missing:
            raise AuthorizationError("You are not authorized to access this resource")
        return current_user

    return _dependency


def require_any_permission(*permission_keys: str) -> Callable:
    """FastAPI dependency factory: user must have at least one listed permission."""

    async def _dependency(
        current_user: UserTokenInfo = Depends(get_current_user),
    ) -> UserTokenInfo:
        if not current_user.has_any_permission(list(permission_keys)):
            raise AuthorizationError("You are not authorized to access this resource")
        return current_user

    return _dependency


def assert_permission(current_user: UserTokenInfo, *permission_keys: str) -> None:
    missing = [k for k in permission_keys if not current_user.has_permission(k)]
    if missing:
        raise AuthorizationError("You are not authorized to access this resource")


def assert_any_permission(current_user: UserTokenInfo, *permission_keys: str) -> None:
    if not current_user.has_any_permission(list(permission_keys)):
        raise AuthorizationError("You are not authorized to access this resource")


async def get_optional_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[UserTokenInfo]:
    """Return the current user when a valid Bearer token is present; otherwise None."""
    authorization = request.headers.get("Authorization")
    if not authorization:
        return None
    try:
        return await get_current_user(request, db)
    except AuthenticationError:
        return None


def validate_refresh_token(refresh_token: str, db: Session) -> RefreshToken:
    # Decode JWT
    try:
        payload = jwt.decode(refresh_token, AUTH2_SECRET_KEY, algorithms=[AUTH2_ALGORITHM])
    except JWTError:
        raise AuthenticationError("Invalid refresh token")

    user_id = payload.get("sub")
    if not user_id:
        raise AuthenticationError("Invalid refresh token: missing user ID")

    # Hash and lookup in DB
    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    refresh_record = db.query(RefreshToken).filter_by(token_hash=token_hash).first()
    if not refresh_record:
        raise AuthenticationError("Refresh token not found")

    # Check revoked
    if refresh_record.revoked:
        raise AuthenticationError("Refresh token has been revoked")

    # Check expiry
    if refresh_record.expires_at < datetime.now(timezone.utc):
        raise AuthenticationError("Refresh token has expired")

    return refresh_record
