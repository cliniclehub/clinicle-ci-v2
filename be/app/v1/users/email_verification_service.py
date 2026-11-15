"""
Email Verification Service
Handles email address verification for email changes
"""
from typing import Optional
from urllib.parse import quote
from uuid import UUID
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
import secrets
import string

from app.common.app_logger import get_logger
from app.common.business_exceptions import ValidationError, NotFoundError, RateLimitError
from app.common.email_validation import validate_email_address
from app.v1.auth.model import EmailVerificationCode
from .model import User as UserModel
from app.v1.organizations.model import Organization as OrganizationModel
from app.v1.email_engine.services import EmailEngineService

logger = get_logger(__name__)

# Email verification code expires in 15 minutes
EMAIL_VERIFICATION_EXPIRE_MINUTES = 15


class EmailVerificationService:
    
    #---------------------------------
    # Validate Email Format
    #---------------------------------
    @staticmethod
    def validate_email(email: str) -> tuple[bool, Optional[str]]:
        """
        Validate email format
        Returns: (is_valid, normalized_email_or_error_message)
        """
        return validate_email_address(email)
    
    #---------------------------------
    # Check if Email Already Exists
    #---------------------------------
    @staticmethod
    def email_already_exists(db: Session, email: str, exclude_user_id: Optional[UUID] = None) -> bool:
        """Check if email already exists for another user"""
        email = email.strip().lower()
        query = db.query(UserModel).filter(
            func.lower(UserModel.email) == email
        )
        
        if exclude_user_id:
            query = query.filter(UserModel.id != exclude_user_id)
        
        return query.first() is not None
    
    #---------------------------------
    # Generate Verification Code
    #---------------------------------
    @staticmethod
    def _generate_verification_code(db: Session, user_id: UUID, email: str) -> str:
        """Generate and save email verification code"""
        code = ''.join(secrets.choice(string.digits) for _ in range(6))
        
        verification = EmailVerificationCode(
            user_id=user_id,
            code=code,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=EMAIL_VERIFICATION_EXPIRE_MINUTES)
        )
        
        db.add(verification)
        db.flush()
        return code
    
    #---------------------------------
    # Send Verification Code
    #---------------------------------
    @staticmethod
    async def send_verification_code(
        db: Session,
        user_id: UUID,
        email: str,
        organization_id: UUID
    ) -> dict:
        """
        Send verification code via email
        Returns: dict with verification_id and status
        """
        method_logger = logger.get_method_logger("send_verification_code")
        
        # Validate email format
        is_valid, result = EmailVerificationService.validate_email(email)
        if not is_valid:
            raise ValidationError(result or "Invalid email format")
        
        validated_email = result
        
        # Check if email already exists for another user
        if EmailVerificationService.email_already_exists(db, validated_email, exclude_user_id=user_id):
            raise ValidationError("This email address is already in use by another account")
        
        # Get user
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if not user:
            raise NotFoundError("User not found")
        
        # Get organization
        org = db.query(OrganizationModel).filter(OrganizationModel.id == organization_id).first()
        if not org:
            raise NotFoundError("Organization not found")
        
        # Check rate limiting (1 per 2 minutes)
        recent_codes = db.query(EmailVerificationCode).filter(
            EmailVerificationCode.user_id == user_id,
            EmailVerificationCode.created_at > datetime.now(timezone.utc) - timedelta(minutes=2)
        ).count()
        
        if recent_codes > 0:
            raise RateLimitError("Please wait 2 minutes before requesting another code")
        
        try:
            # Generate verification code and store the email being verified
            # The _generate_verification_code method already sets the email field
            verification_code = EmailVerificationService._generate_verification_code(db, user_id, validated_email)
            
            # Commit the verification code first (before sending email)
            # This ensures the code is saved even if email sending fails
            db.commit()
            
            # Send verification email (this uses its own transaction)
            email_service = EmailEngineService(db)
            
            # Build verification URL (verify-email page with email param for prefill)
            base_url = f"https://{org.domain}" if org and org.domain else ""
            verification_url = f"{base_url}/verify-email?email={quote(validated_email, safe='')}" if base_url else ""
            
            # Prepare custom variables with verification code and link
            custom_variables = {
                'emailVerificationCode': verification_code,
                'emailVerificationUrl': verification_url
            }
            
            # Send email using the email-verification template
            result = email_service.send_email(
                to_emails=[validated_email],
                template_key='email-verification',
                organization_id=organization_id,
                custom_variables=custom_variables,
                priority=5  # Normal priority
            )
            
            # Check if email sending was successful
            if not result.get('results') or not result['results'][0].get('success', {}).get('success'):
                error_msg = result['results'][0].get('success', {}).get('error_message', 'Unknown error')
                method_logger.error('Email sending failed', None, {
                    'user_id': str(user_id),
                    'email': validated_email,
                    'error': error_msg
                })
                # Don't rollback here - verification code is already committed
                # The code is saved, but email failed - user can request a new code
                raise ValidationError(f"Failed to send verification email: {error_msg}")
            
            method_logger.info('Verification code sent', {
                'user_id': str(user_id),
                'email': validated_email
            })
            
            return {
                'verification_id': str(verification_code),
                'status': 'sent',
                'email': validated_email
            }
            
        except (ValidationError, RateLimitError):
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            method_logger.error('Failed to send verification code', e, {
                'user_id': str(user_id),
                'email': validated_email
            })
            raise ValidationError(f"Failed to send verification code: {str(e)}")
    
    #---------------------------------
    # Verify Code
    #---------------------------------
    @staticmethod
    async def verify_code(
        db: Session,
        user_id: UUID,
        email: str,
        code: str,
        organization_id: UUID
    ) -> dict:
        """
        Verify the code and update user email if verified
        Returns: dict with verified status
        """
        method_logger = logger.get_method_logger("verify_code")
        
        # Validate email format
        is_valid, result = EmailVerificationService.validate_email(email)
        if not is_valid:
            raise ValidationError(result or "Invalid email format")
        
        validated_email = result
        
        # Get user
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if not user:
            raise NotFoundError("User not found")
        
        # Check if email already exists for another user
        if EmailVerificationService.email_already_exists(db, validated_email, exclude_user_id=user_id):
            raise ValidationError("This email address is already in use by another account")
        
        # Find valid verification code
        code_record = db.query(EmailVerificationCode).filter(
            EmailVerificationCode.user_id == user_id,
            EmailVerificationCode.code == code,
            EmailVerificationCode.used == False,
            EmailVerificationCode.expires_at > datetime.now(timezone.utc)
        ).order_by(EmailVerificationCode.created_at.desc()).first()
        
        if not code_record:
            raise ValidationError("Invalid or expired verification code")
        
        # Mark code as used
        code_record.used = True
        
        # Persist email and verification status
        # - Email change: validated_email differs from user.email → update email
        # - Re-verify: same email, mark verified
        # This supports the verify-email page flow (from email link) where user verifies
        # and is redirected—no separate form save.
        email_changed = validated_email != user.email.lower().strip()
        if email_changed:
            user.email = validated_email
            method_logger.info('Email changed and verified', {
                'user_id': str(user_id),
                'new_email': validated_email
            })
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc)
        
        db.commit()
        
        return {
            'verified': True,
            'status': 'verified',
            'email': validated_email
        }
    
    #---------------------------------
    # Get Email Verification Status
    #---------------------------------
    @staticmethod
    def get_email_verification_status(
        db: Session,
        user_id: UUID
    ) -> dict:
        """Get the email verification status for a user"""
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        
        if not user:
            return {
                'email_verified': False,
                'email_verified_at': None,
                'email': None
            }
        
        return {
            'email_verified': user.email_verified or False,
            'email_verified_at': user.email_verified_at.isoformat() if user.email_verified_at else None,
            'email': user.email
        }
