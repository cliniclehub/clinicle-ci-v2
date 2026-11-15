from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import EmailStr, ConfigDict, Field, field_validator
from app.common.base_schema import CamelModel, to_camel
from app.common.name_utils import normalize_optional_person_name, normalize_required_person_name

# ------------------------------
#  User Input Schemas (for creating/updating)
# ------------------------------
class UserBase(CamelModel):
    email: EmailStr
    first_name: str
    last_name: str
    organization_id: UUID

    email_verified: bool = False
    email_verified_at: Optional[datetime] = None
    phone_number: Optional[str] = None
    phone_verified: bool = False
    phone_verified_at: Optional[datetime] = None
    must_change_password: bool = False
    locked: bool = False

    locked_until: Optional[datetime] = None

    roles: List[str] = []
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        """Normalize email to lowercase for consistent storage and lookups"""
        if not v:
            return v
        return v.lower().strip()

    # NOTE: Do not put person-name min-letter validation on UserBase.
    # ``User`` (response) inherits UserBase and is built from DB rows on GET
    # /users/me; rejecting short legacy names there blocks login/profile load.
    # Enforce names only on write schemas (UserCreate / UserUpdate).

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
            from phonenumbers import NumberParseException, PhoneNumberFormat
            
            try:
                parsed_number = phonenumbers.parse(phone, None)
                if not phonenumbers.is_valid_number(parsed_number):
                    raise ValueError('Invalid phone number format')
                # Return in E.164 format (normalized)
                return phonenumbers.format_number(parsed_number, PhoneNumberFormat.E164)
            except NumberParseException as e:
                raise ValueError(f'Invalid phone number format: {str(e)}')
        except ImportError:
            # If phonenumbers library is not available, use basic validation
            # Already validated: starts with +, has digits, minimum length
            return phone   

class UserCreate( UserBase):
    password: str  # Plain text password for creation
    skip_email_verification: bool = False  # If True, skip sending verification email and mark email as verified

    @field_validator('first_name', 'last_name')
    @classmethod
    def normalize_names(cls, v):
        """Store person names in title case; reject single-letter initials on create."""
        return normalize_required_person_name(v)

class UserUpdate(UserBase):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    password: Optional[str] = None  # Plain text password for updates
    organization_id: Optional[UUID] = None  # Only super admins can change this

    email_verified: Optional[bool] = None
    email_verified_at: Optional[datetime] = None
    must_change_password: Optional[bool] = None
    locked: Optional[bool] = None

    locked_until: Optional[datetime] = None

    roles: Optional[List[str]] = None

    @field_validator('first_name', 'last_name')
    @classmethod
    def normalize_optional_names(cls, v):
        """Store person names in title case when provided; reject single-letter initials."""
        return normalize_optional_person_name(v)

# ------------------------------
#  User Output Schema (for responses - no password_hash)
# ------------------------------
class User(UserBase):
    id: UUID
    email: EmailStr
    first_name: str
    last_name: str
    organization_id: UUID
    organization_name: str
    organization_domain: str

    email_verified: bool = False
    email_verified_at: Optional[datetime] = None
    must_change_password: bool = False
    locked: bool = False

    locked_until: Optional[datetime] = None

    roles: List[str] = []

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Sign-in method hints (no secrets); used by settings and clients
    has_password: bool = True
    oauth_providers: List[str] = Field(default_factory=list)

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        str_strip_whitespace=True
    )

class UserListResponse(CamelModel):
    users: List[User]
    total: int
    skip: int
    limit: int

# ------------------------------
# Bulk User Creation Schemas
# ------------------------------
class BulkUserCreateItem(CamelModel):
    email: str  # Changed from EmailStr to str - we'll validate individually in service
    first_name: str
    last_name: str
    password: str
    phone_number: Optional[str] = None
    roles: Optional[List[str]] = None  # Role keys e.g. user, org_admin; default user if omitted/empty

class BulkUserCreateRequest(CamelModel):
    users: List[BulkUserCreateItem]

class BulkUserCreateResult(CamelModel):
    user_id: Optional[UUID] = None
    email: str
    success: bool
    error: Optional[str] = None
    status: Optional[str] = None  # Status message like "User already exists"

class BulkUserCreateResponse(CamelModel):
    success_count: int
    error_count: int
    results: List[BulkUserCreateResult]


class SendEmailVerificationRequest(CamelModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        from app.common.email_validation import normalize_email_address

        if not v:
            return v
        return normalize_email_address(v)


class VerifyEmailCodeRequest(CamelModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        from app.common.email_validation import normalize_email_address

        if not v:
            return v
        return normalize_email_address(v)