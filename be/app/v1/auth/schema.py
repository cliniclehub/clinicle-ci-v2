from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, EmailStr, field_validator, Field
from app.common.base_schema import CamelModel
from app.common.name_utils import normalize_required_person_name
import re


def validate_password_strength(password: str) -> str:
    """Validate password strength requirements"""
    if not re.search(r'[A-Z]', password):
        raise ValueError('Password must contain at least one uppercase letter')
    if not re.search(r'[a-z]', password):
        raise ValueError('Password must contain at least one lowercase letter')
    if not re.search(r'\d', password):
        raise ValueError('Password must contain at least one digit')
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        raise ValueError('Password must contain at least one special character')
    return password


# ------------------------------
# =9 Registration Schemas
# ------------------------------
class RegisterRequest(CamelModel):
    """Request schema for user registration"""
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    org_domain: str = Field(..., min_length=1, max_length=255)
    phone_number: Optional[str] = Field(None, max_length=50)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        """Normalize email to lowercase for consistent storage and lookups"""
        if not v:
            return v
        return v.lower().strip()

    @field_validator('password')
    def validate_password_strength(cls, v):
        """Ensure password meets complexity requirements"""
        return validate_password_strength(v)

    @field_validator('first_name', 'last_name')
    def validate_name(cls, v):
        """Ensure names contain only valid characters and store title-cased."""
        if not re.match(r"^[a-zA-Z\s\-'.]+$", v):
            raise ValueError('Name can only contain letters, spaces, hyphens, apostrophes, and periods')
        return normalize_required_person_name(v)
    
    @field_validator('phone_number')
    @classmethod
    def validate_phone_number(cls, v):
        """Validate and normalize phone number to international format (must start with +)"""
        if not v:
            return None  # Optional field
        
        # Strip whitespace
        phone = v.strip()
        
        # Normalize: remove spaces, dashes, parentheses, and other special characters except +
        # Extract all digits and + signs, then remove all + signs and add one at the start
        digits_and_plus = ''.join(c for c in phone if c.isdigit() or c == '+')
        digits_only = digits_and_plus.replace('+', '')
        normalized = '+' + digits_only
        
        phone = normalized
        
        # Must start with + for international format
        if not phone.startswith('+'):
            raise ValueError('Phone number must be in international format starting with + (e.g., +1234567890)')
        
        # Must have at least country code + number (minimum 8 characters: +1234567)
        if len(phone) < 8:
            raise ValueError('Phone number is too short. Must include country code (e.g., +1234567890)')
        
        # After +, must be digits only
        if not phone[1:].isdigit():
            raise ValueError('Phone number must contain only digits after the + sign')
        
        # Use phonenumbers library for proper validation if available
        try:
            import phonenumbers
            from phonenumbers import PhoneNumberFormat, is_valid_number, parse as parse_phone_number
            from phonenumbers import NumberParseException
            
            try:
                parsed_number = parse_phone_number(phone, None)
                if not is_valid_number(parsed_number):
                    raise ValueError('Invalid phone number format')
                # Return in E.164 format (normalized)
                return phonenumbers.format_number(parsed_number, PhoneNumberFormat.E164)
            except NumberParseException as e:
                raise ValueError(f'Invalid phone number format: {str(e)}')
        except ImportError:
            # If phonenumbers library is not available, use basic validation
            # Already validated: starts with +, has digits, minimum length
            return phone


class EmailVerificationRequest(CamelModel):
    """Request schema for email verification"""
    email: EmailStr
    code: str = Field(..., pattern=r'^\d{6}$')
    org_domain: str = Field(..., min_length=1, max_length=255)


class ResendVerificationRequest(CamelModel):
    """Request schema for resending verification code"""
    email: EmailStr
    org_domain: str = Field(..., min_length=1, max_length=255)


# ------------------------------
# =9 Unified User Token Info Schema
# ------------------------------
class UserTokenInfo(CamelModel):
    """Unified user information for tokens and API responses"""
    id: UUID
    email: str
    first_name: str
    last_name: str
    organization_id: UUID
    organization_name: str
    organization_domain: str
    roles: List[str]
    permissions: List[str] = []
    email_verified: bool
    email_verified_at: Optional[datetime] = None
    must_change_password: bool
    locked: bool
    session_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def has_role(self, role_key: str) -> bool:
        """Check if user has a specific role (including implied org_admin)."""
        from app.v1.auth.org_roles import effective_role_keys

        return role_key in effective_role_keys(self.roles)

    def has_stored_role(self, role_key: str) -> bool:
        """Check stored roles only (no org_owner → org_admin implication)."""
        return role_key in self.roles

    def has_any_role(self, role_keys: List[str]) -> bool:
        """Check if user has any of the specified roles (including implied org_admin)."""
        from app.v1.auth.org_roles import effective_role_keys

        effective = effective_role_keys(self.roles)
        return any(role_key in effective for role_key in role_keys)

    def has_permission(self, permission_key: str) -> bool:
        return permission_key in self.permissions

    def has_any_permission(self, permission_keys: List[str]) -> bool:
        return any(key in self.permissions for key in permission_keys)

    def get_display_name(self) -> str:
        """Get user's display name"""
        return f"{self.first_name} {self.last_name}".strip()

# ------------------------------
# =9 Authentication Schemas
# ------------------------------
class LoginRequest(CamelModel):
    """Request schema for user login"""
    email: EmailStr
    password: str
    org_domain: str = Field(..., min_length=1, max_length=255)
    device_info: Optional[Dict[str, Any]] = None  # Browser, OS, IP info

class TokenResponse(CamelModel):
    """Response schema for token operations"""
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int  # Access token expiry (seconds)
    refresh_expires_in: int  # Refresh token expiry (seconds)


# Use the unified UserTokenInfo instead of separate UserInfo
class LoginResponse(CamelModel):
    """Response schema for successful login"""
    tokens: TokenResponse
    user: UserTokenInfo


class RefreshTokenRequest(CamelModel):
    """Request schema for refreshing access token"""
    refresh_token: str


# ------------------------------
# =9 Password Management Schemas
# ------------------------------
class ForgotPasswordRequest(CamelModel):
    """Request schema for forgot password"""
    email: EmailStr
    org_domain: str = Field(..., min_length=1, max_length=255)


class ResetPasswordRequest(CamelModel):
    """Request schema for password reset"""
    email: EmailStr
    code: str = Field(..., pattern=r'^\d{6}$')
    new_password: str = Field(..., min_length=8, max_length=128)
    org_domain: str = Field(..., min_length=1, max_length=255)

    @field_validator('new_password')
    def validate_password_strength(cls, v):
        """Ensure password meets complexity requirements"""
        return validate_password_strength(v)


class ChangePasswordRequest(CamelModel):
    """Request schema for changing password (authenticated)"""
    old_password: str
    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator('new_password')
    def validate_password_strength(cls, v):
        """Ensure password meets complexity requirements"""
        return validate_password_strength(v)


# ------------------------------
# =9 Session Management Schemas
# ------------------------------
class SessionInfo(CamelModel):
    """Information about a user session"""
    id: int
    device_info: Dict[str, Any]
    created_at: datetime
    last_used_at: Optional[datetime]
    is_current: bool
    revoked: bool
    expires_at: datetime


class UserSessionsResponse(CamelModel):
    """Response schema for listing user sessions"""
    sessions: List[SessionInfo]
    total: int


class RevokeSessionRequest(CamelModel):
    """Request schema for revoking a session"""
    session_id: int


# ------------------------------
# =9 Login History Schemas
# ------------------------------
class LoginHistoryInfo(CamelModel):
    """Information about a past login attempt. Location is country/continent only (no IP, GDPR)."""
    id: int
    email: str
    ip_address: Optional[str] = None  # Deprecated; kept for old records
    login_city: Optional[str] = None
    login_country: Optional[str] = None
    login_continent: Optional[str] = None
    user_agent: Optional[str] = None
    success: bool
    attempted_at: datetime
    device_info: Optional[Dict[str, Any]] = None
    organization_name: Optional[str] = None


class UserLoginHistoryResponse(CamelModel):
    """Response schema for listing user login history"""
    login_history: List[LoginHistoryInfo]
    total: int
    successful_logins: int
    failed_logins: int
    period_days: int


# ------------------------------
# =9 Login Statistics Schemas
# ------------------------------
class LoginStatistics(CamelModel):
    """Response schema for login statistics"""
    total_attempts: int
    successful_logins: int
    failed_logins: int
    success_rate: float
    unique_ips: int
    last_successful_login: Optional[datetime] = None
    period_days: int


class TokenVerificationResponse(CamelModel):
    """Response schema for token verification (used by Cloudflare Workers)"""
    valid: bool
    user_id: str
    organization_id: str
    roles: List[str] = []


# ------------------------------
# =9 OAuth Schemas
# ------------------------------
class OAuthCompleteRequest(CamelModel):
    """Request schema for completing OAuth login/registration.
    The Next.js layer exchanges the authorization code with the provider,
    then forwards the verified ID-token (or its claims) to FastAPI.
    """
    id_token: str = Field(..., min_length=1, description="Raw ID-token JWT from the provider")
    org_domain: str = Field(..., min_length=1, max_length=255)
    device_info: Optional[Dict[str, Any]] = None