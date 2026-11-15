import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, List, Dict, Any
from uuid import UUID
import hashlib
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from fastapi import Request


from app.common.database_pool import get_db
from app.common.business_exceptions import (
    BusinessException, 
    AuthenticationError,
    ValidationError,
    ResourceNotFoundError,
    RateLimitError,
    DuplicateResourceError
)
from app.common.app_logger import get_logger
from app.common.auth_helper import hash_password, verify_password, validate_refresh_token
from app.common.config import (
    AUTH2_SECRET_KEY,
    AUTH2_ALGORITHM,
    AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES,
    AUTH2_REFRESH_TOKEN_EXPIRE_DAYS,
    AUTH2_EMAIL_VERIFICATION_EXPIRE_MINUTES,
    AUTH2_PASSWORD_RESET_EXPIRE_MINUTES,
    AUTH2_MAX_LOGIN_ATTEMPTS,
    AUTH2_LOCKOUT_DURATION_MINUTES,
    GOOGLE_OAUTH_CLIENT_ID,
)
from app.common.name_utils import normalize_person_name
from app.v1.auth.org_roles import USER


# Shown on login failure; unlock instant is in API error details as lockedUntil (ISO) for client-local formatting.
AUTH2_TEMP_LOCKOUT_MESSAGE = (
    "Account temporarily locked due to multiple failed login attempts."
)

from app.v1.users.model import User
from app.v1.organizations.model import Organization
from app.v1.roles.model import Role, UserRole
from .model import (
    EmailVerificationCode,
    PasswordResetCode,
    RefreshToken,
    PasswordHistory,
    LoginAttempt,
    UserOAuthIdentity,
)
from .schema import (
    RegisterRequest,
    EmailVerificationRequest,
    LoginRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ChangePasswordRequest,
    SessionInfo,
    UserTokenInfo,
    LoginHistoryInfo,
    OAuthCompleteRequest,
)

logger = get_logger(__name__)


def _names_from_oauth_claims(raw: Dict[str, Any]) -> Tuple[str, str]:
    """Resolve first/last name from provider claims, falling back to display `name`.

    Google (and similar providers) may omit `family_name` even when they still
    send a full display `name` like "Jane Doe". Prefer structured claims when
    present; otherwise split the display name.
    """
    first = str(raw.get("given_name") or "").strip()
    last = str(raw.get("family_name") or "").strip()
    if first and last:
        return first, last

    full = str(raw.get("name") or "").strip()
    if not full:
        return first, last

    # If given_name prefixes the display name, use the remainder as last name.
    if first and not last and full.lower().startswith(first.lower()):
        remainder = full[len(first) :].strip(" -")
        if remainder:
            return first, remainder

    parts = full.split()
    if len(parts) >= 2:
        if not first:
            first = parts[0]
        if not last:
            last = " ".join(parts[1:])
    elif len(parts) == 1 and not first:
        first = parts[0]

    return first, last


def _oauth_login_guidance_message(providers: List[str], *, oauth_only: bool) -> str:
    """User-facing copy for password login when the account is linked to OAuth provider(s)."""
    if not providers:
        return ""
    prov_lower = [p.lower() for p in providers]
    if oauth_only and len(providers) == 1 and prov_lower[0] == "google":
        return (
            "This email is associated with Google sign-in. "
            "Please log in using Sign in with Google."
        )
    if oauth_only:
        names = ", ".join(p.capitalize() for p in providers)
        return (
            f"This email is associated with {names} sign-in. "
            f"Please log in using the matching sign-in option."
        )
    names = ", ".join(p.capitalize() for p in providers)
    return (
        "Invalid password. This account is also linked to "
        f"{names} — try signing in with that option if you usually do."
    )


class Auth2Service:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------
    # Registration & Email Verification
    # ------------------------------
    
    async def register_user(self, data: RegisterRequest) -> User:
        """Register a new user for an organization"""
        try:
            # Get organization by domain
            org = self.db.query(Organization).filter(
                Organization.domain == data.org_domain,
                Organization.is_active == True
            ).first()
            
            if not org:
                raise ResourceNotFoundError("Organization not found")
            
            # Check if user already exists in this org (case-insensitive; stored emails must be lowercase)
            existing = self.db.query(User).filter(
                func.lower(User.email) == (data.email or "").lower().strip(),
                User.organization_id == org.id,
            ).first()
            
            if existing:
                raise DuplicateResourceError("An account with this email already exists in this organization")
            
            # Hash password using shared utility
            password_hash = hash_password(data.password)
            
            # Create user
            user = User(
                email=data.email.lower(),
                organization_id=org.id,
                first_name=data.first_name,
                last_name=data.last_name,
                password_hash=password_hash,
                email_verified=False,
                must_change_password=False,
                phone_number=data.phone_number if data.phone_number else None,
                phone_verified=False  # Phone verification happens after email verification
            )
            
            self.db.add(user)
            self.db.flush()  # Get user.id without committing
            
            # Add default user role
            default_role = self.db.query(Role).filter_by(key=USER).first()
            if not default_role:
                raise BusinessException("User role not found in system")
            
            self.db.add(UserRole(
                user_id=user.id,
                organization_id=org.id,
                role_id=default_role.id
            ))
            
            # Generate and save verification code
            verification_code = await self._generate_verification_code(user.id)
            
            # Send registration welcome email with verification code BEFORE committing
            # This ensures rollback if email fails
            await self._send_registration_welcome_email(user, verification_code, org)
            
            self.db.commit()
            logger.info(f"User registered successfully: {user.email} in org {org.name}")

            return user
            
        except (DuplicateResourceError, ResourceNotFoundError, BusinessException):
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error registering user: {str(e)}")
            raise BusinessException("Failed to register user")
    
    async def verify_email(self, data: EmailVerificationRequest) -> bool:
        """Verify user's email with the provided code.
        Supports two flows:
        1. Registration: user exists with this email, verify it
        2. Email change: user requested code to NEW email (link lands on /verify-email?email=NEW);
           lookup by email fails since user has OLD email; lookup by code instead.
        """
        try:
            # Get organization
            org = self.db.query(Organization).filter(
                Organization.domain == data.org_domain,
                Organization.is_active == True
            ).first()
            
            if not org:
                raise ResourceNotFoundError("Organization not found")
            
            normalized_email = data.email.lower().strip()
            
            # Flow 1: Look up user by email (registration / existing account)
            user = self.db.query(User).filter(
                func.lower(User.email) == normalized_email,
                User.organization_id == org.id
            ).first()
            
            if user:
                # Registration flow: user has this email, verify it
                if user.email_verified:
                    raise ValidationError("Email already verified")
                
                code_record = self.db.query(EmailVerificationCode).filter(
                    EmailVerificationCode.user_id == user.id,
                    EmailVerificationCode.used == False,
                    EmailVerificationCode.expires_at > datetime.now(timezone.utc)
                ).order_by(EmailVerificationCode.created_at.desc()).first()
                
                if not code_record or code_record.code != data.code:
                    raise ValidationError("Invalid or expired verification code")
                
                code_record.used = True
                user.email_verified = True
                user.email_verified_at = datetime.now(timezone.utc)
                self.db.commit()
                logger.info(f"Email verified for user: {user.email}")
                return True
            
            # Flow 2: User not found by email -> email change flow (user has OLD email, verifying NEW email)
            # Look up by verification code: find valid code, get user from it
            from app.v1.users.email_verification_service import EmailVerificationService
            
            code_record = (
                self.db.query(EmailVerificationCode)
                .join(User, EmailVerificationCode.user_id == User.id)
                .filter(
                    EmailVerificationCode.code == data.code,
                    EmailVerificationCode.used == False,
                    EmailVerificationCode.expires_at > datetime.now(timezone.utc),
                    User.organization_id == org.id
                )
                .order_by(EmailVerificationCode.created_at.desc())
                .first()
            )
            
            if not code_record:
                raise ValidationError("Invalid or expired verification code")
            
            user = code_record.user
            if not user:
                raise ResourceNotFoundError("User not found")
            
            # Email change: new email must not be taken by another user
            if EmailVerificationService.email_already_exists(self.db, normalized_email, exclude_user_id=user.id):
                raise ValidationError("This email address is already in use by another account")
            
            code_record.used = True
            user.email = normalized_email
            user.email_verified = True
            user.email_verified_at = datetime.now(timezone.utc)
            
            self.db.commit()
            logger.info(f"Email changed and verified for user id={user.id}, new email={user.email}")
            return True
            
        except (ResourceNotFoundError, ValidationError):
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error verifying email: {str(e)}")
            raise BusinessException("Failed to verify email")
    
    async def resend_verification_code(self, email: str, org_domain: str) -> None:
        """Resend email verification code"""
        try:
            # Check rate limiting (1 per 2 minutes) - use case-insensitive comparison
            normalized_email = email.lower().strip()
            recent_codes = self.db.query(EmailVerificationCode).join(User).filter(
                func.lower(User.email) == normalized_email,
                EmailVerificationCode.created_at > datetime.now(timezone.utc) - timedelta(minutes=2)
            ).count()
            
            if recent_codes > 0:
                raise RateLimitError("Please wait 2 minutes before requesting another code")
            
            # Get organization and user
       # Get organization by domain
            org = self.db.query(Organization).filter(
                Organization.domain == org_domain,
                Organization.is_active == True
            ).first()
            
            if not org:
                raise ResourceNotFoundError("Organization not found")
            
            # Use case-insensitive comparison for resilience
            # This ensures we find users even if email in DB has uppercase letters
            normalized_email = email.lower().strip()
            user = self.db.query(User).filter(
                func.lower(User.email) == normalized_email,
                User.organization_id == org.id
            ).first()
            
            if not user:
                raise ResourceNotFoundError("User not found")
            
            if user.email_verified:
                raise ValidationError("Email already verified")
            
            # Generate new code
            verification_code = await self._generate_verification_code(user.id)
            
            # Send verification email BEFORE committing
            # This ensures rollback if email fails
            await self._send_verification_email(user, verification_code, org)
            
            self.db.commit()
            logger.info(f"Verification code resent for: {email}")
            
        except (ResourceNotFoundError, ValidationError, RateLimitError, BusinessException):
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error resending verification code: {str(e)}")
            raise BusinessException("Failed to resend verification code")
    
    # ------------------------------
    # Authentication & Session Management
    # ------------------------------
    
    async def authenticate_user(self, data: LoginRequest, request: Request) -> Tuple[User, Organization, Optional[Dict[str, str]]]:
        """Authenticate user and return user and organization"""
        try:
            # First check if organization exists (without is_active filter)
            org = self.db.query(Organization).filter(
                Organization.domain == data.org_domain
            ).first()
            
            if not org:
                # Track failed attempt
                await self._track_login_attempt(
                    email=data.email.lower(),
                    org_id=None,
                    success=False,
                    request=request
                )
                raise AuthenticationError("Invalid credentials")
            
            # Check if organization is active
            if not org.is_active:
                # Track failed attempt
                await self._track_login_attempt(
                    email=data.email.lower(),
                    org_id=org.id,
                    success=False,
                    request=request
                )
                raise AuthenticationError("Organization is inactive. Please contact platform administrator for assistance.")
            
            # Get user first - use case-insensitive comparison for resilience
            # This ensures we find users even if email in DB has uppercase letters
            normalized_email = data.email.lower().strip()
            user = self.db.query(User).filter(
                func.lower(User.email) == normalized_email,
                User.organization_id == org.id
            ).first()
            
            # Temp lock for known users: user.locked_until is authoritative. Do not also block on
            # _is_account_locked when lockout has expired — login_attempts failures during lockout
            # keep refreshing the rolling window and would deny login forever after locked_until passes.
            now_utc = datetime.now(timezone.utc)
            if user and user.locked_until and user.locked_until > now_utc:
                raise AuthenticationError(
                    AUTH2_TEMP_LOCKOUT_MESSAGE,
                    locked_until=user.locked_until,
                )
            if not user and await self._is_account_locked(data.email.lower(), org.id):
                raise AuthenticationError(AUTH2_TEMP_LOCKOUT_MESSAGE)
            
            if not user:
                # Track failed attempt
                await self._track_login_attempt(
                    email=data.email.lower(),
                    org_id=org.id,
                    success=False,
                    request=request,
                    user_id=None,
                )
                raise AuthenticationError("Invalid credentials")
            
            # OAuth-only accounts have no password — block password login
            if not user.password_hash:
                linked = self.db.query(UserOAuthIdentity.provider).filter_by(user_id=user.id).all()
                providers = [r.provider for r in linked]
                if providers:
                    raise AuthenticationError(
                        _oauth_login_guidance_message(providers, oauth_only=True)
                    )
                raise AuthenticationError("This account does not have a password. Please contact support.")

            # Verify password
            if not verify_password(data.password, user.password_hash):
                # Track failed attempt
                await self._track_login_attempt(
                    email=data.email.lower(),
                    org_id=org.id,
                    success=False,
                    request=request,
                    user_id=user.id,
                )
                
                # Increment failed attempts
                user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
                
                # Lock account if too many attempts
                if user.failed_login_attempts >= AUTH2_MAX_LOGIN_ATTEMPTS:
                    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=AUTH2_LOCKOUT_DURATION_MINUTES)
                    self.db.commit()
                    
                    # Check if account is now locked and provide appropriate message
                    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
                        raise AuthenticationError(
                            AUTH2_TEMP_LOCKOUT_MESSAGE,
                            locked_until=user.locked_until,
                        )
                
                self.db.commit()
                linked_pw = self.db.query(UserOAuthIdentity.provider).filter_by(user_id=user.id).all()
                oauth_providers_pw = [r.provider for r in linked_pw]
                if oauth_providers_pw:
                    raise AuthenticationError(
                        _oauth_login_guidance_message(oauth_providers_pw, oauth_only=False)
                    )
                raise AuthenticationError("Invalid credentials")
            
            if not getattr(user, "can_login", True):
                raise AuthenticationError(
                    "This account is managed by a parent or guardian and cannot sign in. "
                    "Please ask your organization administrator for access."
                )

            # Check if account is locked
            if user.locked:
                raise AuthenticationError("Account is locked. Please contact support.")
            
            # Check temporary lockout
            if user.locked_until and user.locked_until > datetime.now(timezone.utc):
                raise AuthenticationError(
                    AUTH2_TEMP_LOCKOUT_MESSAGE,
                    locked_until=user.locked_until,
                )
            
            # Check email verification
            if not user.email_verified:
                raise ValidationError("Email not verified. Please check your email for verification code.")
            
            # Reset failed attempts on successful login
            user.failed_login_attempts = 0
            user.locked_until = None
            
            # Track successful login; capture location for session device_info
            location = await self._track_login_attempt(
                email=data.email.lower(),
                org_id=org.id,
                success=True,
                request=request,
                user_id=user.id,
            )
            
            self.db.commit()
            logger.info(f"User authenticated: {user.email} in org {org.name}")
            
            return user, org, location
            
        except (AuthenticationError, ValidationError):
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error authenticating user: {str(e)}")
            raise AuthenticationError("Authentication failed")
    
    # ------------------------------
    # OAuth Login / Registration
    # ------------------------------

    # -- Provider-specific ID-token verifiers ----------------------------------

    async def _verify_google_id_token(self, id_token_str: str) -> Dict[str, Any]:
        """Verify a Google ID-token JWT using Google's public JWKS and return its claims."""
        import httpx
        from jose import jwt as jose_jwt, JWTError as JoseJWTError, jwk as jose_jwk

        GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs"

        # Fetch Google public keys
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(GOOGLE_JWKS_URI)
            resp.raise_for_status()
            jwks = resp.json()

        # Get the key id from the token header to select the right key
        unverified_header = jose_jwt.get_unverified_header(id_token_str)
        kid = unverified_header.get("kid")
        if not kid:
            raise ValidationError("Google ID token missing kid header")

        # Find the matching key
        rsa_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                rsa_key = key
                break
        if not rsa_key:
            raise ValidationError("Unable to find matching Google signing key")

        # Decode + verify
        try:
            claims = jose_jwt.decode(
                id_token_str,
                rsa_key,
                algorithms=["RS256"],
                audience=GOOGLE_OAUTH_CLIENT_ID,
                issuer=["https://accounts.google.com", "accounts.google.com"],
                # We currently forward only the ID token from the Next.js OAuth layer.
                # Google ID tokens can contain at_hash, which python-jose verifies only
                # when an access_token is also supplied. Disable this specific check
                # here because we do not use/forward the access token in this flow.
                options={"verify_at_hash": False},
            )
        except JoseJWTError as e:
            raise ValidationError(f"Invalid Google ID token: {e}")

        # Require email + verified
        if not claims.get("email"):
            raise ValidationError("Google ID token missing email claim")
        if not claims.get("email_verified", False):
            raise ValidationError("Google email is not verified")

        return claims

    async def _verify_oauth_id_token(self, provider: str, id_token_str: str) -> Dict[str, Any]:
        """Dispatch to the correct provider verifier. Returns normalized claims dict."""
        if provider == "google":
            raw = await self._verify_google_id_token(id_token_str)
            first_name, last_name = _names_from_oauth_claims(raw)
            return {
                "sub": raw["sub"],
                "email": raw["email"].lower().strip(),
                "first_name": normalize_person_name(first_name),
                "last_name": normalize_person_name(last_name),
            }
        # Future providers go here (apple, microsoft, etc.)
        raise ValidationError(f"Unsupported OAuth provider: {provider}")

    # -- Core OAuth upsert logic -----------------------------------------------

    async def oauth_login_or_register(
        self,
        provider: str,
        data: OAuthCompleteRequest,
        request: Request,
    ) -> Tuple[User, Organization]:
        """Verify an OAuth ID-token, find-or-create the user, and return (user, org).
        Caller is responsible for generating tokens / building response."""
        try:
            # 1. Resolve organization
            org = self.db.query(Organization).filter(
                Organization.domain == data.org_domain,
                Organization.is_active == True,
            ).first()
            if not org:
                raise ResourceNotFoundError("Organization not found")

            # 2. Verify ID-token with the provider's public keys
            claims = await self._verify_oauth_id_token(provider, data.id_token)
            sub = claims["sub"]
            email = claims["email"]

            # 3. Lookup existing OAuth identity
            identity = self.db.query(UserOAuthIdentity).filter_by(
                provider=provider, provider_subject=sub
            ).first()

            if identity:
                # Existing identity → load user, verify org match
                user = self.db.query(User).filter_by(id=identity.user_id).first()
                if not user:
                    raise AuthenticationError("User account not found")
                if user.organization_id != org.id:
                    raise AuthenticationError(
                        "This social account is registered with a different organization."
                    )
                if not getattr(user, "can_login", True):
                    raise AuthenticationError(
                        "This account is managed by a parent or guardian and cannot sign in."
                    )
                await self._track_login_attempt(
                    email=user.email.lower(),
                    org_id=org.id,
                    success=True,
                    request=request,
                    user_id=user.id,
                )
                self.db.commit()
                logger.info(f"OAuth login for existing user: {user.email} via {provider}")
                return user, org

            # 4. No identity — check if a user with this email already exists in the org
            existing_user = self.db.query(User).filter(
                func.lower(User.email) == email,
                User.organization_id == org.id,
            ).first()

            if existing_user:
                if not getattr(existing_user, "can_login", True):
                    raise AuthenticationError(
                        "This account is managed by a parent or guardian and cannot sign in."
                    )
                # Existing account in this org with same email:
                # link this provider and allow login (supports password->Google and multi-provider linking).
                self.db.add(UserOAuthIdentity(
                    user_id=existing_user.id,
                    provider=provider,
                    provider_subject=sub,
                    email_at_link=email,
                ))
                await self._track_login_attempt(
                    email=existing_user.email.lower(),
                    org_id=org.id,
                    success=True,
                    request=request,
                    user_id=existing_user.id,
                )
                self.db.commit()
                logger.info(
                    f"OAuth identity linked for existing user: {existing_user.email} via {provider}"
                )
                return existing_user, org

            # 5. New user — create account + identity
            user = User(
                email=email,
                organization_id=org.id,
                first_name=normalize_person_name(
                    (claims.get("first_name", "")[:100] or email.split("@")[0])
                ),
                last_name=normalize_person_name(claims.get("last_name", "")[:100] or ""),
                password_hash=None,  # OAuth-only, no password
                email_verified=True,  # Provider already verified the email
                email_verified_at=datetime.now(timezone.utc),
                must_change_password=False,
                phone_number=None,
                phone_verified=False,
            )
            self.db.add(user)
            self.db.flush()

            # Assign default user role
            default_role = self.db.query(Role).filter_by(key=USER).first()
            if not default_role:
                raise BusinessException("User role not found in system")
            self.db.add(UserRole(
                user_id=user.id, organization_id=org.id, role_id=default_role.id
            ))

            # Create OAuth identity link
            self.db.add(UserOAuthIdentity(
                user_id=user.id,
                provider=provider,
                provider_subject=sub,
                email_at_link=email,
            ))

            await self._track_login_attempt(
                email=email.lower(),
                org_id=org.id,
                success=True,
                request=request,
                user_id=user.id,
            )
            self.db.commit()
            logger.info(f"OAuth new user registered: {email} via {provider} in org {org.name}")
            return user, org

        except (AuthenticationError, ValidationError, ResourceNotFoundError, DuplicateResourceError, BusinessException):
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"OAuth login/register error: {str(e)}")
            raise BusinessException("OAuth authentication failed")

    async def generate_tokens(self, user: User, org: Organization, device_info: Optional[Dict] = None) -> Tuple[str, str, int]:
        """Generate access and refresh tokens. Multiple sessions allowed (no same-device revoke)."""
        try:
            # Get user roles for this organization
            user_roles = self.db.query(Role).join(UserRole).filter(
                UserRole.user_id == user.id,
                UserRole.organization_id == org.id
            ).all()
            
            role_keys = [role.key for role in user_roles]
            from app.v1.roles.permission_bootstrap import (
                ensure_permission_catalog,
                resolve_permission_keys_for_user_roles,
            )
            ensure_permission_catalog(self.db)
            permission_keys = resolve_permission_keys_for_user_roles(self.db, user_roles)
            
            # Generate access token
            access_token_data = {
                "sub": str(user.id),
                "email": user.email,
                "org_id": str(org.id),
                "org_domain": org.domain,
                "roles": role_keys,
                "permissions": permission_keys,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES),
                "iat": datetime.now(timezone.utc)
            }
            
            access_token = jwt.encode(access_token_data, AUTH2_SECRET_KEY, algorithm=AUTH2_ALGORITHM)
            
            # Generate refresh token
            refresh_token_id = str(UUID(int=secrets.randbits(128)))
            refresh_token_data = {
                "sub": str(user.id),
                "jti": refresh_token_id,
                "exp": datetime.now(timezone.utc) + timedelta(days=AUTH2_REFRESH_TOKEN_EXPIRE_DAYS),
                "iat": datetime.now(timezone.utc)
            }
            
            refresh_token = jwt.encode(refresh_token_data, AUTH2_SECRET_KEY, algorithm=AUTH2_ALGORITHM)
            
            # Store refresh token hash
            token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
            
            now_utc = datetime.now(timezone.utc)
            refresh_record = RefreshToken(
                user_id=user.id,
                token_hash=token_hash,
                device_info=device_info or {},
                expires_at=now_utc + timedelta(days=AUTH2_REFRESH_TOKEN_EXPIRE_DAYS),
                # Same moment as login; updated again on each access-token refresh
                last_used_at=now_utc,
            )
            
            self.db.add(refresh_record)
            self.db.commit()
            
            # Update access token with session_id
            access_token_data["session_id"] = str(refresh_record.id)
            access_token = jwt.encode(access_token_data, AUTH2_SECRET_KEY, algorithm=AUTH2_ALGORITHM)
            
            return access_token, refresh_token
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error generating tokens: {str(e)}")
            raise BusinessException("Failed to generate tokens")
    
    async def refresh_access_token(self, refresh_token: str) -> Tuple[str, int]:
        """Generate new access token from refresh token and extend refresh token expiry"""
        try:
            # Validate refresh token
            refresh_record = validate_refresh_token(refresh_token, self.db)
            
            # Get user and organization
            user = self.db.query(User).filter_by(id=refresh_record.user_id).first()
            if not user:
                raise AuthenticationError("User not found")
            
            org = self.db.query(Organization).filter_by(id=user.organization_id).first()
            if not org or not org.is_active:
                raise AuthenticationError("Organization not found or inactive")
            
            # Extend refresh token expiry (reset to full duration from now)
            new_refresh_expiry = datetime.now(timezone.utc) + timedelta(days=AUTH2_REFRESH_TOKEN_EXPIRE_DAYS)
            refresh_record.expires_at = new_refresh_expiry
            refresh_record.last_used_at = datetime.now(timezone.utc)
            self.db.commit()
            
            # Generate new access token
            user_roles = self.db.query(Role).join(UserRole).filter(
                UserRole.user_id == user.id,
                UserRole.organization_id == org.id
            ).all()
            
            role_keys = [role.key for role in user_roles]
            from app.v1.roles.permission_bootstrap import (
                ensure_permission_catalog,
                resolve_permission_keys_for_user_roles,
            )
            ensure_permission_catalog(self.db)
            permission_keys = resolve_permission_keys_for_user_roles(self.db, user_roles)
            
            access_token_data = {
                "sub": str(user.id),
                "email": user.email,
                "org_id": str(org.id),
                "org_domain": org.domain,
                "roles": role_keys,
                "permissions": permission_keys,
                "session_id": str(refresh_record.id),
                "exp": datetime.now(timezone.utc) + timedelta(minutes=AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES),
                "iat": datetime.now(timezone.utc)
            }
            
            access_token = jwt.encode(access_token_data, AUTH2_SECRET_KEY, algorithm=AUTH2_ALGORITHM)
            
            # Calculate refresh token expiry in seconds from now
            refresh_expires_in_seconds = int((new_refresh_expiry - datetime.now(timezone.utc)).total_seconds())
            
            return access_token, refresh_expires_in_seconds
            
        except AuthenticationError as e:
            raise
        except Exception as e:
            logger.error(f"Error refreshing token: {str(e)}")
            raise AuthenticationError("Failed to refresh token")
    
    async def logout(self, refresh_token: str) -> None:
        """Revoke refresh token"""
        try:
            token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
            refresh_record = self.db.query(RefreshToken).filter_by(
                token_hash=token_hash,
                revoked=False
            ).first()
            
            if refresh_record:
                refresh_record.revoked = True
                self.db.commit()
                
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error during logout: {str(e)}")
            # Don't raise error on logout failure
    
    # ------------------------------
    # Password Management
    # ------------------------------
    
    async def send_password_reset_code(self, data: ForgotPasswordRequest) -> None:
        """Send password reset code to user"""
        try:
            # Get organization and user
            org = self.db.query(Organization).filter(
                Organization.domain == data.org_domain,
                Organization.is_active == True
            ).first()


            if not org:
                # Don't reveal if org exists
                logger.info(f"Password reset requested for unknown org: {data.org_domain}")
                return
            
            # Use case-insensitive comparison for resilience
            # This ensures we find users even if email in DB has uppercase letters
            normalized_email = data.email.lower().strip()
            user = self.db.query(User).filter(
                func.lower(User.email) == normalized_email,
                User.organization_id == org.id
            ).first()
            
            if not user:
                # Don't reveal if user exists
                logger.info(f"Password reset requested for unknown user: {data.email}")
                return
            
            # Check rate limiting
            recent_codes = self.db.query(PasswordResetCode).filter(
                PasswordResetCode.user_id == user.id,
                PasswordResetCode.created_at > datetime.now(timezone.utc) - timedelta(minutes=2)
            ).count()
            
            if recent_codes > 0:
                raise RateLimitError("Please wait 2 minutes before requesting another reset code")
            
            # Generate reset code
            code = ''.join(secrets.choice(string.digits) for _ in range(6))
            
            reset_code = PasswordResetCode(
                user_id=user.id,
                code=code,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=AUTH2_PASSWORD_RESET_EXPIRE_MINUTES)
            )
            
            self.db.add(reset_code)
            self.db.commit()
            
            logger.info(f"Password reset code generated for: {user.email}")
            
            # Send password reset email
            await self._send_password_reset_email(user, code, org)
            
        except RateLimitError:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error sending password reset code: {str(e)}")
            # Don't raise error to avoid revealing user existence
    
    async def reset_password(self, data: ResetPasswordRequest) -> None:
        """Reset user password with code"""
        try:
            # Get organization and user
            org = self.db.query(Organization).filter(
                Organization.domain == data.org_domain,
                Organization.is_active == True
            ).first()
            
            if not org:
                raise ValidationError("Invalid reset code")
            
            # Use case-insensitive comparison for resilience
            # This ensures we find users even if email in DB has uppercase letters
            normalized_email = data.email.lower().strip()
            user = self.db.query(User).filter(
                func.lower(User.email) == normalized_email,
                User.organization_id == org.id
            ).first()
            
            if not user:
                raise ValidationError("Invalid reset code")
            
            # Match the submitted code directly (not merely the latest unused code).
            code_record = self.db.query(PasswordResetCode).filter(
                PasswordResetCode.user_id == user.id,
                PasswordResetCode.code == data.code,
            ).order_by(PasswordResetCode.created_at.desc()).first()

            if not code_record:
                raise ValidationError("Invalid reset code")
            if code_record.used:
                raise ValidationError(
                    "This reset code has already been used. Try logging in with your new password, "
                    "or request a new code."
                )
            if code_record.expires_at <= datetime.now(timezone.utc):
                raise ValidationError("Reset code has expired. Please request a new one.")

            # Use consolidated password validation and update logic
            await self._validate_and_update_password(
                user=user,
                new_password=data.new_password,
                require_current_password=False,
                commit=False,
            )

            code_record.used = True

            # Revoke all refresh tokens for security
            self.db.query(RefreshToken).filter_by(
                user_id=user.id,
                revoked=False
            ).update({"revoked": True})

            self.db.commit()
            logger.info(f"Password reset for user: {user.email}")
            
        except ValidationError:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error resetting password: {str(e)}")
            raise BusinessException("Failed to reset password")
    
    async def change_password(self, user_id: UUID, data: ChangePasswordRequest) -> None:
        """Change user password (authenticated)"""
        try:
            user = self.db.query(User).filter_by(id=user_id).first()
            if not user:
                raise ResourceNotFoundError("User not found")
            
            # Use consolidated password validation and update logic
            await self._validate_and_update_password(
                user=user,
                new_password=data.new_password,
                current_password=data.old_password,
                require_current_password=True
            )
            
            # Revoke all refresh tokens for security (same as password reset)
            self.db.query(RefreshToken).filter_by(
                user_id=user.id,
                revoked=False
            ).update({"revoked": True})
            
            self.db.commit()
            logger.info(f"Password changed for user: {user.email}")
            
        except (ResourceNotFoundError, ValidationError):
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error changing password: {str(e)}")
            raise BusinessException("Failed to change password")
    
    # ------------------------------
    # Session Management
    # ------------------------------
    
    async def get_user_sessions(self, user_id: UUID, current_session_id: Optional[int] = None) -> List[SessionInfo]:
        """Get all active sessions for a user"""
        try:
            sessions = self.db.query(RefreshToken).filter(
                RefreshToken.user_id == user_id
            ).order_by(RefreshToken.created_at.desc()).all()
            
            return [
                SessionInfo(
                    id=session.id,
                    device_info=session.device_info,
                    created_at=session.created_at,
                    last_used_at=session.last_used_at,
                    is_current=session.id == current_session_id,
                    revoked=session.revoked,
                    expires_at=session.expires_at
                )
                for session in sessions
            ]
            
        except Exception as e:
            logger.error(f"Error getting user sessions: {str(e)}")
            raise BusinessException("Failed to get sessions")
    
    async def revoke_session(self, session_id: int, user_id: UUID) -> None:
        """Revoke a specific session"""
        try:
            session = self.db.query(RefreshToken).filter_by(
                id=session_id,
                user_id=user_id,
                revoked=False
            ).first()
            
            if not session:
                raise ResourceNotFoundError("Session not found")
            
            session.revoked = True
            self.db.commit()
            
            logger.info(f"Session revoked: {session_id} for user: {user_id}")
            
        except ResourceNotFoundError:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error revoking session: {str(e)}")
            raise BusinessException("Failed to revoke session")
    
    async def cleanup_expired_sessions(self) -> dict[str, int]:
        """Clean up expired sessions and codes. Returns per-table delete counts."""
        counts = {
            "email_verification_codes": 0,
            "password_reset_codes": 0,
            "refresh_tokens": 0,
            "login_attempts": 0,
            "password_history": 0,
        }
        try:
            counts["email_verification_codes"] = (
                self.db.query(EmailVerificationCode)
                .filter(
                    or_(
                        EmailVerificationCode.expires_at < datetime.now(timezone.utc),
                        EmailVerificationCode.used.is_(True),
                    )
                )
                .delete(synchronize_session=False)
            )

            counts["password_reset_codes"] = (
                self.db.query(PasswordResetCode)
                .filter(
                    or_(
                        PasswordResetCode.expires_at < datetime.now(timezone.utc),
                        PasswordResetCode.used.is_(True),
                    )
                )
                .delete(synchronize_session=False)
            )

            counts["refresh_tokens"] = (
                self.db.query(RefreshToken)
                .filter(RefreshToken.expires_at < datetime.now(timezone.utc))
                .delete(synchronize_session=False)
            )

            counts["login_attempts"] = (
                self.db.query(LoginAttempt)
                .filter(LoginAttempt.attempted_at < datetime.now(timezone.utc) - timedelta(days=30))
                .delete(synchronize_session=False)
            )

            users_with_excess_history = (
                self.db.query(PasswordHistory.user_id, func.count(PasswordHistory.id))
                .group_by(PasswordHistory.user_id)
                .having(func.count(PasswordHistory.id) > 3)
                .all()
            )

            for user_id, count in users_with_excess_history:
                entries_to_delete = (
                    self.db.query(PasswordHistory.id)
                    .filter(PasswordHistory.user_id == user_id)
                    .order_by(PasswordHistory.created_at.asc())
                    .limit(count - 3)
                    .all()
                )

                if entries_to_delete:
                    entry_ids = [entry[0] for entry in entries_to_delete]
                    self.db.query(PasswordHistory).filter(
                        PasswordHistory.id.in_(entry_ids)
                    ).delete(synchronize_session=False)
                    counts["password_history"] += len(entry_ids)
                    logger.info(
                        f"Cleaned up {len(entry_ids)} old password history entries for user {user_id}"
                    )

            self.db.commit()
            logger.info("Cleaned up expired auth data", extra=counts)
            return counts

        except Exception as e:
            self.db.rollback()
            logger.error(f"Error cleaning up sessions: {str(e)}")
            raise
    
    # ------------------------------
    # Helper Methods
    # ------------------------------
    

    
    async def _generate_verification_code(self, user_id: UUID) -> str:
        """Generate and save email verification code"""
        code = ''.join(secrets.choice(string.digits) for _ in range(6))
        
        verification = EmailVerificationCode(
            user_id=user_id,
            code=code,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=AUTH2_EMAIL_VERIFICATION_EXPIRE_MINUTES)
        )
        
        self.db.add(verification)
        return code
    
    async def _send_registration_welcome_email(self, user: User, verification_code: str, org: Organization) -> None:
        """Send registration welcome email with verification code"""
        try:
            from urllib.parse import quote
            from app.v1.email_engine.services import EmailEngineService
            
            # Initialize email service
            email_service = EmailEngineService(self.db)
            
            # Build verification URL (verify-email page with email param for prefill)
            base_url = f"https://{org.domain}" if org and org.domain else ""
            verification_url = f"{base_url}/verify-email?email={quote(user.email, safe='')}" if base_url else ""
            
            # Prepare custom variables with verification code and link
            custom_variables = {
                'emailVerificationCode': verification_code,
                'emailVerificationUrl': verification_url
            }

            # Send email using the registration-welcome template
            result = email_service.send_email(
                to_emails=[user.email],
                template_key='registration-welcome',
                organization_id=org.id,
                custom_variables=custom_variables,
                priority=5  # Normal priority
            )
            
            # Check if email sending was successful
            if not result.get('results') or not result['results'][0].get('success', {}).get('success'):
                error_msg = result['results'][0].get('success', {}).get('error_message', 'Unknown error')
                logger.error(f"Email sending failed for {user.email}: {error_msg}")
                raise BusinessException(f"Failed to send welcome email: {error_msg}")
            
            logger.info(f"Registration welcome email sent to {user.email}: {result}")
            
        except Exception as e:
            logger.error(f"Failed to send registration welcome email to {user.email}: {str(e)}")
            raise BusinessException(f"Failed to send welcome email: {str(e)}")
    
    async def _send_verification_email(self, user: User, verification_code: str, org: Organization) -> None:
        """Send email verification code"""
        try:
            from urllib.parse import quote
            from app.v1.email_engine.services import EmailEngineService
            
            # Initialize email service
            email_service = EmailEngineService(self.db)
            
            # Build verification URL (verify-email page with email param for prefill)
            base_url = f"https://{org.domain}" if org and org.domain else ""
            verification_url = f"{base_url}/verify-email?email={quote(user.email, safe='')}" if base_url else ""
            
            # Prepare custom variables with verification code and link
            custom_variables = {
                'emailVerificationCode': verification_code,
                'emailVerificationUrl': verification_url
            }
            
            # Send email using the email-verification template
            result = email_service.send_email(
                to_emails=[user.email],
                template_key='email-verification',
                organization_id=org.id,
                custom_variables=custom_variables,
                priority=5  # Normal priority
            )
            
            # Check if email sending was successful
            if not result.get('results') or not result['results'][0].get('success', {}).get('success'):
                error_msg = result['results'][0].get('success', {}).get('error_message', 'Unknown error')
                logger.error(f"Email sending failed for {user.email}: {error_msg}")
                raise BusinessException(f"Failed to send verification email: {error_msg}")
            
            logger.info(f"Verification email sent to {user.email}: {result}")
            
        except Exception as e:
            logger.error(f"Failed to send verification email to {user.email}: {str(e)}")
            raise BusinessException(f"Failed to send verification email: {str(e)}")
    
    async def _is_account_locked(self, email: str, org_id: UUID) -> bool:
        """Check if account is locked due to failed attempts"""
        window_start = datetime.now(timezone.utc) - timedelta(minutes=AUTH2_LOCKOUT_DURATION_MINUTES)
        failed_attempts = (
            self.db.query(func.count(LoginAttempt.id))
            .filter(
                func.lower(LoginAttempt.email) == (email or "").lower().strip(),
                LoginAttempt.organization_id == org_id,
                LoginAttempt.success.is_(False),
                LoginAttempt.attempted_at > window_start,
            )
            .scalar()
        ) or 0
        
        return failed_attempts >= AUTH2_MAX_LOGIN_ATTEMPTS
    
    async def _track_login_attempt(
        self,
        email: str,
        org_id: Optional[UUID],
        success: bool,
        request: Request,
        user_id: Optional[UUID] = None,
    ) -> Optional[dict]:
        """Track login attempt for security monitoring. Stores city/country/continent only (no IP) for GDPR.
        Returns location dict {login_city, login_country} for use when creating refresh token (sessions).
        Successful logins also stamp users.last_successful_login_at (durable; outside audit purge)."""
        # Durable last-login must not depend on GeoIP / attempt-row success.
        if success and user_id:
            try:
                self._touch_last_successful_login_by_id(user_id)
            except Exception as e:
                logger.error(f"Error updating last_successful_login_at: {str(e)}")

        try:
            login_city = None
            login_country = None
            login_continent = None
            user_agent = request.headers.get("user-agent", "")[:500]

            if org_id:
                attempt = LoginAttempt(
                    email=email.lower(),
                    user_id=user_id,
                    organization_id=org_id,
                    ip_address=None,  # No raw IP stored (GDPR)
                    login_city=login_city,
                    login_country=login_country,
                    login_continent=login_continent,
                    user_agent=user_agent,
                    success=success
                )
                self.db.add(attempt)

            return {"login_city": login_city, "login_country": login_country} if (login_city or login_country) else None

        except Exception as e:
            logger.error(f"Error tracking login attempt: {str(e)}")
            # Don't fail the login process due to tracking error
            return None

    def _touch_last_successful_login(self, user: User) -> None:
        """Stamp durable last-login on the user row (survives login_attempts purge)."""
        user.last_successful_login_at = datetime.now(timezone.utc)

    def _touch_last_successful_login_by_id(self, user_id: UUID) -> None:
        user = self.db.query(User).filter(User.id == user_id).first()
        if user is not None:
            self._touch_last_successful_login(user)

    def _parse_device_info_from_user_agent(self, user_agent: Optional[str]) -> Dict[str, str]:
        """Best-effort parsing for login history fallback when session device_info is unavailable."""
        ua = (user_agent or "").lower()
        if not ua:
            return {"browser": "Unknown browser", "os": "Unknown OS", "device": "Unknown"}

        # Browser detection (ordered by specificity)
        if "edg/" in ua:
            browser = "Edge"
        elif "opr/" in ua or "opera" in ua:
            browser = "Opera"
        elif "chrome/" in ua and "chromium" not in ua:
            browser = "Chrome"
        elif "firefox/" in ua:
            browser = "Firefox"
        elif "safari/" in ua and "chrome/" not in ua:
            browser = "Safari"
        else:
            browser = "Unknown browser"

        # OS detection
        if "windows nt" in ua:
            os_name = "Windows"
        elif "mac os x" in ua or "macintosh" in ua:
            os_name = "macOS"
        elif "android" in ua:
            os_name = "Android"
        elif "iphone" in ua or "ipad" in ua or "ios" in ua:
            os_name = "iOS"
        elif "linux" in ua:
            os_name = "Linux"
        else:
            os_name = "Unknown OS"

        # Device type detection
        if "mobile" in ua or "iphone" in ua or "android" in ua:
            device = "mobile"
        elif "ipad" in ua or "tablet" in ua:
            device = "tablet"
        else:
            device = "desktop"

        return {"browser": browser, "os": os_name, "device": device}
    
    async def _is_password_reused(self, user_id: UUID, new_password: str) -> bool:
        """Check if password was used in last 3 passwords"""
        # Get last 3 password hashes
        history = self.db.query(PasswordHistory).filter_by(
            user_id=user_id
        ).order_by(PasswordHistory.created_at.desc()).limit(3).all()
        
        logger.info(f"Checking password reuse for user {user_id}: found {len(history)} history entries")
        
        for i, record in enumerate(history):
            is_match = verify_password(new_password, record.password_hash)
            logger.info(f"  History entry {i+1}: match = {is_match}")
            if is_match:
                logger.info(f"  Password reuse detected in history entry {i+1}")
                return True
        
        logger.info(f"  No password reuse detected")
        return False
    
    async def _validate_and_update_password(
        self, 
        user: User, 
        new_password: str, 
        current_password: Optional[str] = None,
        require_current_password: bool = False,
        commit: bool = True,
    ) -> None:
        """
        Consolidated password validation and update logic.
        
        Args:
            user: User object
            new_password: New password to set
            current_password: Current password (for verification if required)
            require_current_password: Whether to verify current password
        """
        try:
            if require_current_password and not (
                user.password_hash and str(user.password_hash).strip()
            ):
                linked = self.db.query(UserOAuthIdentity.provider).filter_by(user_id=user.id).all()
                provs = [r.provider for r in linked]
                if provs:
                    names = ", ".join(p.capitalize() for p in provs)
                    raise ValidationError(
                        f"This account uses {names} sign-in and has no local password. "
                        "Sign in with your provider. To use email and password here, contact your administrator."
                    )
                raise ValidationError(
                    "This account does not have a password set. Please contact support."
                )

            # Verify current password if required
            if require_current_password and current_password:
                if not verify_password(current_password, user.password_hash):
                    raise ValidationError("Current password is incorrect")
            
            # Check if new password is same as current password
            if user.password_hash and verify_password(new_password, user.password_hash):
                raise ValidationError("New password must be different from current password")
            
            # Check password history
            logger.info(f"Checking password reuse for user: {user.email}")
            is_reused = await self._is_password_reused(user.id, new_password)
            logger.info(f"Password reuse check result: {is_reused}")
            
            if is_reused:
                raise ValidationError("Password has been used recently. Please choose a different password.")
            
            # Save old password to history (always save if user has a password)
            if user.password_hash:
                password_history = PasswordHistory(
                    user_id=user.id,
                    password_hash=user.password_hash
                )
                self.db.add(password_history)
                logger.info(f"Saved password to history for user: {user.email}")
            else:
                logger.info(f"No previous password to save to history for user: {user.email}")
            
            # Update password
            user.password_hash = hash_password(new_password)
            user.must_change_password = False
            
            # Commit or flush the password history and password update
            if commit:
                self.db.commit()
                logger.info(f"Password updated and committed for user: {user.email}")
            else:
                self.db.flush()
                logger.info(f"Password updated (pending commit) for user: {user.email}")
            
            # Clean up excess password history for this user (keep only last 3)
            await self._cleanup_user_password_history(user.id, commit=commit)
            
            # Send password change confirmation email
            await self._send_password_change_confirmation_email(user)
            
        except ValidationError:
            raise
        except Exception as e:
            logger.error(f"Error validating and updating password for user {user.email}: {str(e)}")
            raise BusinessException("Failed to update password")
    
    async def _cleanup_user_password_history(self, user_id: UUID, commit: bool = True) -> None:
        """Clean up excess password history for a specific user (keep only last 3)"""
        try:
            # Count current password history entries
            count = self.db.query(PasswordHistory).filter_by(user_id=user_id).count()
            logger.info(f"Password history cleanup for user {user_id}: found {count} entries")
            
            if count > 3:
                excess_count = count - 3
                logger.info(f"Cleaning up {excess_count} excess password history entries for user {user_id}")
                
                # Get the IDs of the oldest entries to delete (keep newest 3)
                entries_to_delete = (
                    self.db.query(PasswordHistory.id)
                    .filter(PasswordHistory.user_id == user_id)
                    .order_by(PasswordHistory.created_at.asc())
                    .limit(excess_count)
                    .all()
                )
                
                if entries_to_delete:
                    entry_ids = [entry[0] for entry in entries_to_delete]
                    logger.info(f"Deleting password history entries: {entry_ids}")

                    self.db.query(PasswordHistory).filter(
                        PasswordHistory.id.in_(entry_ids)
                    ).delete(synchronize_session=False)

                    if commit:
                        self.db.commit()
                    else:
                        self.db.flush()
                    logger.info(f"Successfully cleaned up {len(entry_ids)} old password history entries for user {user_id}")
                else:
                    logger.info(f"No entries to delete for user {user_id}")
            else:
                logger.info(f"No cleanup needed for user {user_id} (count: {count})")
                    
        except Exception as e:
            logger.error(f"Error cleaning up password history for user {user_id}: {str(e)}")
            self.db.rollback()
            # Don't fail the password reset due to cleanup error
    
    def build_user_info(self, user: User, org: Organization) -> UserTokenInfo:
        """Build user info response"""
        # Get user roles
        user_roles = self.db.query(Role).join(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.organization_id == org.id
        ).all()
        from app.v1.roles.permission_bootstrap import (
            ensure_permission_catalog,
            resolve_permission_keys_for_user_roles,
        )
        ensure_permission_catalog(self.db)
        permission_keys = resolve_permission_keys_for_user_roles(self.db, user_roles)
        
        return UserTokenInfo(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            organization_id=org.id,
            organization_name=org.name,
            organization_domain=org.domain,
            roles=[role.key for role in user_roles],
            permissions=permission_keys,
            email_verified=user.email_verified,
            email_verified_at=user.email_verified_at,
            must_change_password=user.must_change_password,
            locked=user.locked,
            session_id=None,  # Will be set by token generation
            created_at=user.created_at,
            updated_at=user.updated_at
        )

    # ------------------------------
    # Login History Methods
    # ------------------------------

    def _login_attempts_filters_for_user(self, user: User, from_date: datetime):
        """Match attempts for this user: user_id (preferred) or legacy rows (NULL user_id + email)."""
        return and_(
            LoginAttempt.organization_id == user.organization_id,
            LoginAttempt.attempted_at >= from_date,
            or_(
                LoginAttempt.user_id == user.id,
                and_(
                    LoginAttempt.user_id.is_(None),
                    func.lower(LoginAttempt.email) == func.lower(user.email),
                ),
            ),
        )

    async def get_user_login_history(
        self, 
        user_id: UUID, 
        days: int = 30,
        include_failed: bool = False
    ) -> List[LoginHistoryInfo]:
        """Get user's login history for the specified period"""
        try:
            # Calculate the date threshold
            from_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Get the user's email and organization
            user = self.db.query(User).filter_by(id=user_id).first()
            if not user:
                raise ResourceNotFoundError("User not found")
            
            # Build the query for login attempts
            query = self.db.query(LoginAttempt).filter(
                self._login_attempts_filters_for_user(user, from_date)
            )
            
            # Filter by success status if needed
            if not include_failed:
                query = query.filter(LoginAttempt.success == True)
            
            # Get login attempts ordered by most recent
            login_attempts = query.order_by(LoginAttempt.attempted_at.desc()).all()
            
            # Transform to response format
            login_history = []
            for attempt in login_attempts:
                # Try to get device info from refresh tokens if this was a successful login
                device_info = None
                if attempt.success:
                    # Look for a refresh token created around the same time
                    refresh_token = self.db.query(RefreshToken).filter(
                        RefreshToken.user_id == user_id,
                        RefreshToken.created_at >= attempt.attempted_at - timedelta(minutes=5),
                        RefreshToken.created_at <= attempt.attempted_at + timedelta(minutes=5)
                    ).first()
                    if refresh_token:
                        device_info = refresh_token.device_info

                # Fallback: failed attempts (and any success without matching token) derive
                # basic browser/OS/device from user-agent for better UI visibility.
                if not device_info:
                    device_info = self._parse_device_info_from_user_agent(attempt.user_agent)
                
                login_history.append(LoginHistoryInfo(
                    id=attempt.id,
                    email=attempt.email,
                    ip_address=attempt.ip_address,
                    login_city=getattr(attempt, "login_city", None),
                    login_country=getattr(attempt, "login_country", None),
                    login_continent=getattr(attempt, "login_continent", None),
                    user_agent=attempt.user_agent,
                    success=attempt.success,
                    attempted_at=attempt.attempted_at,
                    device_info=device_info,
                    organization_name=user.organization.name if user.organization else None
                ))
            
            return login_history
            
        except ResourceNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error getting user login history: {str(e)}")
            raise BusinessException("Failed to get login history")

    async def get_user_login_statistics(
        self, 
        user_id: UUID, 
        days: int = 30
    ) -> Dict[str, Any]:
        """Get user's login statistics for the specified period"""
        try:
            # Calculate the date threshold
            from_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Get the user's email and organization
            user = self.db.query(User).filter_by(id=user_id).first()
            if not user:
                raise ResourceNotFoundError("User not found")
            
            la_filters = self._login_attempts_filters_for_user(user, from_date)
            # Get total login attempts
            total_attempts = self.db.query(LoginAttempt).filter(la_filters).count()
            
            # Get successful logins
            successful_logins = self.db.query(LoginAttempt).filter(
                la_filters,
                LoginAttempt.success == True,
            ).count()
            
            # Get failed logins
            failed_logins = total_attempts - successful_logins
            
            # Unique locations (by country) for successful logins in period
            unique_ips = self.db.query(LoginAttempt.login_country).filter(
                la_filters,
                LoginAttempt.success == True,
            ).distinct().count()
            
            # Durable last login on the user row (survives login_attempts purge).
            # Period counters above still come from the short-retention audit table.
            return {
                "total_attempts": total_attempts,
                "successful_logins": successful_logins,
                "failed_logins": failed_logins,
                "success_rate": (successful_logins / total_attempts * 100) if total_attempts > 0 else 0,
                "unique_ips": unique_ips,
                "last_successful_login": user.last_successful_login_at,
                "period_days": days
            }
            
        except ResourceNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error getting user login statistics: {str(e)}")
            raise BusinessException("Failed to get login statistics")
    
    async def _send_password_reset_email(self, user: User, reset_code: str, org: Organization) -> None:
        """Send password reset email to user"""
        try:
            from urllib.parse import quote
            from app.v1.email_engine.services import EmailEngineService
            
            # Initialize email service
            email_service = EmailEngineService(self.db)
            
            # Build password reset URL (reset-password page with email param for prefill)
            base_url = f"https://{org.domain}" if org and org.domain else ""
            password_reset_url = f"{base_url}/reset-password?email={quote(user.email, safe='')}" if base_url else ""
            
            # Prepare custom variables with reset code and link
            custom_variables = {
                'passwordResetCode': reset_code,
                'passwordResetUrl': password_reset_url
            }
            
            # Send email using the password-reset template
            result = email_service.send_email(
                to_emails=[user.email],
                template_key='password-reset',
                organization_id=org.id,
                custom_variables=custom_variables,
                priority=5  # Normal priority
            )
            
            logger.info(f"Password reset email sent to: {user.email}")
            
        except Exception as e:
            logger.error(f"Error sending password reset email to {user.email}: {str(e)}")
            # Don't raise error to avoid revealing user existence
    
    async def _send_password_change_confirmation_email(self, user: User) -> None:
        """Send password change confirmation email to user"""
        try:
            from app.v1.email_engine.services import EmailEngineService
            from datetime import datetime, timezone
            
            # Get user's organization
            org = self.db.query(Organization).filter_by(id=user.organization_id).first()
            if not org:
                logger.error(f"Organization not found for user {user.email}")
                return
            
            # Initialize email service
            email_service = EmailEngineService(self.db)
            
            # Prepare custom variables for the email template
            custom_variables = {
                'changeTime': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'),
                'ipAddress': 'Unknown',  # Could be enhanced to capture IP from request context
                'device': 'Unknown'      # Could be enhanced to capture device info from request context
            }
            
            # Send email using the password-changed template
            result = email_service.send_email(
                to_emails=[user.email],
                template_key='password-changed',
                organization_id=org.id,
                custom_variables=custom_variables,
                priority=5  # Normal priority
            )
            
            logger.info(f"Password change confirmation email sent to: {user.email}")
            
        except Exception as e:
            logger.error(f"Error sending password change confirmation email to {user.email}: {str(e)}")
            # Don't raise error to avoid failing password change process
