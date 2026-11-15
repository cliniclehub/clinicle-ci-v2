from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages

from app.common.config import AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES, AUTH2_REFRESH_TOKEN_EXPIRE_DAYS

from .services import Auth2Service
from .schema import (
    RegisterRequest,
    EmailVerificationRequest,
    ResendVerificationRequest,
    LoginRequest,
    LoginResponse,
    RefreshTokenRequest,
    TokenResponse,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.v1.users.phone_verification_service import PhoneVerificationService
from app.v1.organizations.model import Organization as OrganizationModel
from app.v1.users.model import User as UserModel




# Create router
router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
        429: {"description": "Too Many Requests"}
    }
)


# ------------------------------
# Registration & Email Verification
# ------------------------------

#--------------------------------
# Register - Public
#--------------------------------
@router.post("/register")
async def register(
    data: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Register a new user account
    
    - **email**: User's email address
    - **password**: Strong password (min 8 chars, uppercase, lowercase, number, special char)
    - **first_name**: User's first name
    - **last_name**: User's last name
    - **org_domain**: Organization domain (e.g., acme.localhost)
    """
    service = Auth2Service(db)
    user = await service.register_user(data)
    
    return success_response(
        data={
            "userId": str(user.id),
            "email": user.email,
            "requiresVerification": True
        },
        message=SuccessMessages.CREATED
    )


#--------------------------------
# Verify Email - Public
#--------------------------------
@router.post("/verify-email")
async def verify_email(
    data: EmailVerificationRequest,
    db: Session = Depends(get_db)
):
    """
    Verify email address with 6-digit code
    
    - **email**: User's email address
    - **code**: 6-digit verification code
    - **org_domain**: Organization domain
    """
    service = Auth2Service(db)
    success = await service.verify_email(data)
    
    return success_response(
        data={"verified": success},
        message=SuccessMessages.UPDATED
    )


#--------------------------------
# Resend Verification - Public
#--------------------------------
@router.post("/resend-verification")
async def resend_verification(
    data: ResendVerificationRequest,
    db: Session = Depends(get_db)
):
    """
    Resend email verification code
    
    Rate limited to 1 request per 2 minutes
    """
    service = Auth2Service(db)
    await service.resend_verification_code(data.email, data.org_domain)
    
    return success_response(
        message=SuccessMessages.UPDATED,
        data={"sent": True}
    )

# ------------------------------
# Authentication & Session Management
# ------------------------------

#--------------------------------
# Login - Public
#--------------------------------
@router.post("/login")
async def login(
    data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Authenticate user and create session
    
    - **email**: User's email address
    - **password**: User's password
    - **org_domain**: Organization domain
    - **device_info**: Optional device information
    """
    service = Auth2Service(db)
    
    # Authenticate user
    user, org, location = await service.authenticate_user(data, request)
    
    # Merge location into device_info for session display (city, country; no IP)
    device_info = dict(data.device_info or {})
    if location:
        device_info["login_city"] = location.get("login_city")
        device_info["login_country"] = location.get("login_country")
    
    # Generate tokens
    access_token, refresh_token = await service.generate_tokens(
        user, org, device_info
    )
    
    # Build response
    user_info = service.build_user_info(user, org)
    
    response_data = LoginResponse(
        tokens=TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="Bearer",
            expires_in=AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_expires_in=AUTH2_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
        ),
        user=user_info
    )
    
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=response_data
    )


#--------------------------------
# Refresh Token - Public
#--------------------------------
@router.post("/refresh")
async def refresh_token(
    data: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Refresh access token using refresh token
    """
    service = Auth2Service(db)
    new_access_token, refresh_expires_in_seconds = await service.refresh_access_token(data.refresh_token)
    
    response_data = TokenResponse(
        access_token=new_access_token,
        refresh_token=data.refresh_token,  # Return same refresh token
        token_type="Bearer",
        expires_in=AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        refresh_expires_in=refresh_expires_in_seconds  # Use actual DB expiry time
    )
    
    return success_response(
        message=SuccessMessages.UPDATED,
        data=response_data
    )


#--------------------------------
# Logout - Public
#--------------------------------
@router.post("/logout")
async def logout(
    data: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Logout user and revoke refresh token.
    Send refresh_token in the JSON body (e.g. {"refreshToken": "..."}); do not pass it in the query string.
    """
    service = Auth2Service(db)
    await service.logout(data.refresh_token)
    
    return success_response(
        message=SuccessMessages.DELETED,
        data={"loggedOut": True}
    )


# ------------------------------
# Password Management
# ------------------------------

#--------------------------------
# Forgot Password - Public
#--------------------------------
@router.post("/forgot-password")
async def forgot_password(
    data: ForgotPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Request password reset code
    
    Rate limited to prevent abuse
    """
    service = Auth2Service(db)
    await service.send_password_reset_code(data)
    
    # Always return success to prevent user enumeration
    return success_response(
        message=SuccessMessages.UPDATED,
        data={"sent": True}
    )


#--------------------------------
# Reset Password - Public
#--------------------------------
@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Reset password using code
    
    - **email**: User's email address
    - **code**: 6-digit reset code
    - **new_password**: New password (must meet complexity requirements)
    - **org_domain**: Organization domain
    """
    service = Auth2Service(db)
    await service.reset_password(data)
    
    return success_response(
        message=SuccessMessages.UPDATED,
        data={"reset": True}
    )
