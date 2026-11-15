from fastapi import APIRouter, Depends, Body
from sqlalchemy.orm import Session
from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import get_current_user, UserTokenInfo
from app.v1.users.schema import UserUpdate, SendEmailVerificationRequest, VerifyEmailCodeRequest
from app.v1.users.services import UserService
from app.v1.users.phone_verification_service import PhoneVerificationService
from app.v1.users.email_verification_service import EmailVerificationService
from app.common.app_logger import get_logger
from app.common.business_exceptions import BadRequestError

logger = get_logger(__name__)

router = APIRouter(
    prefix="/users",
    tags=["users"]
)



#********************************************************************************
# Current User Routes (for all authenticated users)
#********************************************************************************

#--------------------------------
# Get Current User
#--------------------------------
@router.get("/me")
async def get_current_user_info(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_data = await UserService.get_user(db, current_user.id, None)
    return success_response(data=user_data, message=SuccessMessages.RETRIEVED)

#--------------------------------
# Update Current User
#--------------------------------
@router.put("/me")
async def update_current_user(
    user_data: UserUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user profile
    
    SECURITY: Users cannot update their own roles or organization_id through this endpoint.
    These fields will be automatically stripped from the request.
    """
    # SECURITY: Strip sensitive fields that users shouldn't be able to change themselves
    if user_data.roles is not None:
        logger.warning(f"User {current_user.id} attempted to update their own roles. Request denied.")
        user_data.roles = None
    
    # Prevent users from changing sensitive admin fields
    sensitive_fields = ['email_verified', 'email_verified_at', 'must_change_password', 'locked', 
                        'locked_until']
    for field in sensitive_fields:
        if hasattr(user_data, field) and getattr(user_data, field) is not None:
            logger.warning(f"User {current_user.id} attempted to change {field}. Request denied.")
            setattr(user_data, field, None)
    
    updated_user = await UserService.update_current_user_secure(db, current_user.id, user_data)
    return success_response(data=updated_user, message=SuccessMessages.UPDATED)


#--------------------------------
# Change Current User Password
#--------------------------------
@router.post("/me/change-password")
async def change_current_user_password(
    password_data: dict = Body(..., example={"currentPassword": "oldpass123", "newPassword": "newpass123"}),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change current user's password - requires old password verification"""
    current_password = password_data.get("currentPassword")
    new_password = password_data.get("newPassword")
    
    if not current_password or not new_password:
        raise BadRequestError("Both currentPassword and newPassword are required")
    
    if current_password == new_password:
        raise BadRequestError("New password must be different from current password")
    
    # Verify current password and update
    success = await UserService.change_user_password_with_verification(
        db, current_user.id, current_password, new_password
    )
    
    if not success:
        raise BadRequestError("Current password is incorrect")
    
    return success_response(message="Password changed successfully")

#--------------------------------
# Create Password for OAuth-Only Current User
#--------------------------------
@router.post("/me/set-password")
async def set_current_user_password(
    password_data: dict = Body(..., example={"newPassword": "NewPass123!"}),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create the first local password for an OAuth-only account."""
    new_password = password_data.get("newPassword")

    if not new_password:
        raise BadRequestError("newPassword is required")

    success = await UserService.set_user_password_for_oauth_account(
        db, current_user.id, new_password
    )

    if not success:
        raise BadRequestError("Failed to set password")

    return success_response(message="Password created successfully")

#--------------------------------
# Send Phone Verification Code
#--------------------------------
@router.post("/me/phone/send-verification")
async def send_phone_verification_code(
    phone_data: dict = Body(..., example={"phoneNumber": "+1234567890"}),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send verification code to phone number via SMS"""
    phone_number = phone_data.get("phoneNumber")
    
    if not phone_number:
        raise BadRequestError("phoneNumber is required")
    
    if not current_user.organization_id:
        raise BadRequestError("Organization not found in token")
    
    result = await PhoneVerificationService.send_verification_code(
        db=db,
        user_id=current_user.id,
        phone_number=phone_number,
        organization_id=current_user.organization_id
    )
    
    return success_response(data=result, message="Verification code sent successfully")

#--------------------------------
# Verify Phone Code
#--------------------------------
@router.post("/me/phone/verify")
async def verify_phone_code(
    verification_data: dict = Body(..., example={"phoneNumber": "+1234567890", "code": "123456", "updateUser": False}),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verify phone number with code
    
    updateUser: If True, update user's phone and verification status immediately (for first-time verification).
                If False (default), only verify without updating user (for settings page changes).
    """
    phone_number = verification_data.get("phoneNumber")
    code = verification_data.get("code")
    update_user = verification_data.get("updateUser", False)  # Default to False for settings page changes
    
    if not phone_number or not code:
        raise BadRequestError("phoneNumber and code are required")
    
    if not current_user.organization_id:
        raise BadRequestError("Organization not found in token")
    
    result = await PhoneVerificationService.verify_code(
        db=db,
        user_id=current_user.id,
        phone_number=phone_number,
        code=code,
        organization_id=current_user.organization_id,
        update_user=update_user
    )
    
    if not result.get('verified'):
        raise BadRequestError("Invalid verification code")
    
    return success_response(data=result, message="Phone number verified successfully")

#--------------------------------
# Get Phone Verification Status
#--------------------------------
@router.get("/me/phone/verification-status")
async def get_phone_verification_status(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get phone verification status for current user"""
    status = PhoneVerificationService.get_phone_verification_status(
        db=db,
        user_id=current_user.id
    )
    
    return success_response(data=status, message=SuccessMessages.RETRIEVED)

#--------------------------------
# Send Email Verification Code
#--------------------------------
@router.post("/me/email/send-verification")
async def send_email_verification_code(
    email_data: SendEmailVerificationRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send verification code to email address"""
    if not current_user.organization_id:
        raise BadRequestError("Organization not found in token")
    
    result = await EmailVerificationService.send_verification_code(
        db=db,
        user_id=current_user.id,
        email=email_data.email,
        organization_id=current_user.organization_id
    )
    
    return success_response(data=result, message="Verification code sent successfully")

#--------------------------------
# Verify Email Code
#--------------------------------
@router.post("/me/email/verify")
async def verify_email_code(
    verification_data: VerifyEmailCodeRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify email address with code"""
    if not current_user.organization_id:
        raise BadRequestError("Organization not found in token")
    
    result = await EmailVerificationService.verify_code(
        db=db,
        user_id=current_user.id,
        email=verification_data.email,
        code=verification_data.code,
        organization_id=current_user.organization_id
    )
    
    if not result.get('verified'):
        raise BadRequestError("Invalid verification code")
    
    return success_response(data=result, message="Email address verified successfully")

#--------------------------------
# Get Email Verification Status
#--------------------------------
@router.get("/me/email/verification-status")
async def get_email_verification_status(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get email verification status for current user"""
    status = EmailVerificationService.get_email_verification_status(
        db=db,
        user_id=current_user.id
    )
    
    return success_response(data=status, message=SuccessMessages.RETRIEVED)
