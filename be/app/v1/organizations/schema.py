import re
from datetime import datetime
from typing import Any, Optional, Dict, List
from uuid import UUID
from pydantic import EmailStr, Field, field_validator
from app.common.timezone_utils import validate_iana_timezone
from app.v1.enums import OrgTypeEnum
from app.common.base_schema import CamelModel


class TrackingScriptsConfig(CamelModel):
    """Validated tracking / tag management configuration for an organization."""
    enabled: Optional[bool] = Field(False, description="Master toggle for tag injection")
    gtm_container_id: Optional[str] = Field(None, max_length=20, description="Google Tag Manager container ID (GTM-XXXXXXX)")
    custom_head_scripts: Optional[str] = Field(None, max_length=5000, description="Custom scripts injected into <head>")
    custom_body_scripts: Optional[str] = Field(None, max_length=5000, description="Custom scripts injected before </body>")

    @field_validator('gtm_container_id')
    @classmethod
    def validate_gtm_id(cls, v):
        if v is not None and v != "":
            if not re.match(r'^GTM-[A-Z0-9]{6,10}$', v):
                raise ValueError('GTM Container ID must match format GTM-XXXXXXX')
        return v or None


class OrganizationValidators:
    """Mixin class with shared organization validations"""
    
    @field_validator('name', 'domain')
    @classmethod
    def validate_not_empty_if_provided(cls, v):
        if v is not None:  # Only validate if value is provided
            if not v or not v.strip():
                raise ValueError('Field cannot be empty or contain only whitespace')
            return v.strip()
        return v

    @field_validator('domain')
    @classmethod
    def validate_domain_format_if_provided(cls, v):
        if v is not None:  # Only validate if value is provided
            # Basic domain validation - should contain at least one dot and valid characters
            if '.' not in v or len(v.split('.')[0]) == 0:
                raise ValueError('Invalid domain format')
            return v.lower()
        return v


class OrganizationBase(CamelModel, OrganizationValidators):
    name: str = Field(..., min_length=1, max_length=255, description="Organization name")
    domain: str = Field(..., min_length=1, max_length=255, description="Organization domain")

    is_active: Optional[bool] = True
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    terms_of_use: Optional[str] = None
    privacy_policy: Optional[str] = None
    org_type: Optional[OrgTypeEnum] = None
    code: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state_province: Optional[str] = None
    zip_postal: Optional[str] = None
    country: Optional[str] = None
    support_email: Optional[str] = None
    info_email: Optional[str] = None
    admin_email: Optional[str] = None
    landing_page_html: Optional[str] = None
    site_theme: Optional[Dict[str, Any]] = None
    tracking_scripts: Optional[Dict[str, Any]] = None
    notification_settings: Optional[Dict[str, Any]] = None
    enforce_phone_validation: Optional[bool] = False
    timezone: str = Field(default="UTC", max_length=64, description="IANA timezone for org scheduling (e.g. Europe/Istanbul)")

    @field_validator('timezone')
    @classmethod
    def validate_timezone(cls, v):
        if v is None or (isinstance(v, str) and not v.strip()):
            return "UTC"
        return validate_iana_timezone(v)


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(OrganizationBase):
    name: Optional[str] = None
    domain: Optional[str] = None
    timezone: Optional[str] = None


class Organization(OrganizationBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    user_count: Optional[int] = Field(None, description="Number of users in the organization")

    class Config:
        from_attributes = True

    @classmethod
    def from_org_model(cls, org: Any) -> "Organization":
        return cls.model_validate(org)


class ContactFormCreate(CamelModel):
    """Public contact form submission (resolved by X-Organization-Domain)."""

    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    category: str = Field(..., min_length=1, max_length=64)
    subject: str = Field(..., min_length=1, max_length=300)
    message: str = Field(..., min_length=10, max_length=10000)


class OrganizationPublic(CamelModel):
    name: str
    domain: str
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    terms_of_use: Optional[str] = None
    privacy_policy: Optional[str] = None
    site_theme: Optional[Dict[str, Any]] = None
    tracking_scripts: Optional[Dict[str, Any]] = None
    admin_email: Optional[str] = None
    support_email: Optional[str] = None
    enforce_phone_validation: Optional[bool] = False

    class Config:
        from_attributes = True

    @classmethod
    def from_org_model(cls, org: Any) -> "OrganizationPublic":
        return cls.model_validate(org)


class OrganizationLandingPagePublic(CamelModel):
    """Public site landing body HTML only — separate from white-label branding payload."""

    landing_page_html: Optional[str] = None

    class Config:
        from_attributes = True


class OrganizationMobileListItem(CamelModel):
    """Lightweight schema for mobile app org picker screen.

    Intentionally a subset of OrganizationPublic -- includes only what the
    mobile app needs: identity (id, name, domain), branding (logo, favicon,
    siteTheme), and enforcePhoneValidation (needed during registration).
    Omits large text fields (termsOfUse, privacyPolicy) which are fetched later
    via /get-white-label-data-by-domain after selection.
    """
    id: UUID
    name: str
    domain: str
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    site_theme: Optional[Dict[str, Any]] = None
    enforce_phone_validation: Optional[bool] = False

    class Config:
        from_attributes = True


class OrganizationDropdown(CamelModel):
    id: UUID
    name: str
    domain: str

    class Config:
        from_attributes = True
