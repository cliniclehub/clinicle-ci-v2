"""
Phone Verification Service
Handles phone number verification using Twilio Verify API
"""
from typing import Optional
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.common.app_logger import get_logger
from app.common.business_exceptions import ValidationError, NotFoundError
from .model import User as UserModel
from app.v1.organizations.model import Organization as OrganizationModel

logger = get_logger(__name__)


class PhoneVerificationService:
    
    #---------------------------------
    # Validate Phone Number Format
    #---------------------------------
    @staticmethod
    def validate_phone_number(phone_number: str) -> tuple[bool, Optional[str]]:
        """
        Validate phone number format using phonenumbers library
        Returns: (is_valid, formatted_number_or_error_message)
        """
        if not phone_number:
            return False, "Phone number is required"
        
        # Strip whitespace
        phone = phone_number.strip()
        
        # Normalize: remove spaces, dashes, parentheses, and other special characters except +
        # Extract all digits and + signs, then remove all + signs and add one at the start
        digits_and_plus = ''.join(c for c in phone if c.isdigit() or c == '+')
        digits_only = digits_and_plus.replace('+', '')
        normalized = '+' + digits_only
        
        phone = normalized
        
        # Must start with + for international format
        if not phone.startswith('+'):
            return False, "Phone number must be in international format starting with + (e.g., +1234567890)"
        
        # Try to import phonenumbers first
        try:
            import phonenumbers
            from phonenumbers import NumberParseException, PhoneNumberFormat
        except ImportError:
            # Fallback validation if phonenumbers library is not installed
            # Basic validation: should start with + and contain only digits
            if phone.startswith("+") and phone[1:].isdigit() and len(phone) >= 8:
                return True, phone
            return False, "Phone number must be in international format starting with + (e.g., +1234567890)"
        
        # Now that we know phonenumbers is available, use it
        try:
            # Parse the phone number
            parsed_number = phonenumbers.parse(phone, None)
            
            # Check if the number is valid
            is_valid = phonenumbers.is_valid_number(parsed_number)
            
            if not is_valid:
                return False, "Invalid phone number format"
            
            # Format the number in E.164 format (international format)
            formatted_number = phonenumbers.format_number(parsed_number, PhoneNumberFormat.E164)
            
            return True, formatted_number
            
        except NumberParseException as e:
            return False, f"Invalid phone number format: {str(e)}"
        except Exception as e:
            logger.error('Error validating phone number', e, {'phone_number': phone_number})
            return False, f"Error validating phone number: {str(e)}"
    
    #---------------------------------
    # Check if Organization Requires Phone Verification
    #---------------------------------
    @staticmethod
    def organization_requires_verification(db: Session, organization_id: UUID) -> bool:
        """Check if the organization has phone verification enabled"""
        org = db.query(OrganizationModel).filter(OrganizationModel.id == organization_id).first()
        if not org:
            return False
        return org.enforce_phone_validation or False
    
    #---------------------------------
    # Send Verification Code
    #---------------------------------
    @staticmethod
    async def send_verification_code(
        db: Session,
        user_id: UUID,
        phone_number: str,
        organization_id: UUID
    ) -> dict:
        """
        Send verification code via Twilio Verify API
        Returns: dict with verification_sid and status
        """
        method_logger = logger.get_method_logger("send_verification_code")
        
        # Check if organization requires verification
        if not PhoneVerificationService.organization_requires_verification(db, organization_id):
            raise ValidationError("Phone verification is not enabled for this organization")
        
        # Validate phone number format
        is_valid, result = PhoneVerificationService.validate_phone_number(phone_number)
        if not is_valid:
            raise ValidationError(result or "Invalid phone number format")
        
        # Use the formatted phone number
        formatted_phone = result
        
        try:
            from twilio.rest import Client
            from app.common.config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
            
            if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_VERIFY_SERVICE_SID:
                raise ValidationError("Twilio is not configured. Please contact support.")
            
            # Initialize Twilio client
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            
            # Send verification code using Twilio Verify
            # Note: Twilio Verify API does not support custom_friendly_name parameter
            # The friendly_name in templates must be configured in Twilio Console
            # For per-organization customization, consider using multiple Verify Services
            verification = client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID) \
                .verifications \
                .create(to=formatted_phone, channel='sms')
            
            method_logger.info('Verification code sent', {
                'user_id': str(user_id),
                'phone_number': formatted_phone,
                'verification_sid': verification.sid,
                'status': verification.status
            })
            
            # Note: Twilio Verify API generates, sends, and manages the code securely
            # Verification status is tracked in the users table (phone_verified, phone_verified_at)
            
            return {
                'verification_sid': verification.sid,
                'status': verification.status,
                'phone_number': formatted_phone
            }
            
        except ImportError:
            raise ValidationError("Twilio library is not installed. Please contact support.")
        except Exception as e:
            method_logger.error('Failed to send verification code', e, {
                'user_id': str(user_id),
                'phone_number': formatted_phone
            })
            raise ValidationError(f"Failed to send verification code: {str(e)}")
    
    #---------------------------------
    # Verify Code
    #---------------------------------
    @staticmethod
    async def verify_code(
        db: Session,
        user_id: UUID,
        phone_number: str,
        code: str,
        organization_id: UUID,
        update_user: bool = True
    ) -> dict:
        """
        Verify the code using Twilio Verify API
        
        Args:
            update_user: If True (default), update user's phone and verification status immediately.
                        If False, only verify the code without updating user (for settings page changes).
                        Use True for login/registration flows, False for settings page changes.
        
        Returns: dict with verified status
        """
        method_logger = logger.get_method_logger("verify_code")
        
        # Check if organization requires verification
        if not PhoneVerificationService.organization_requires_verification(db, organization_id):
            raise ValidationError("Phone verification is not enabled for this organization")
        
        # Validate phone number format
        is_valid, result = PhoneVerificationService.validate_phone_number(phone_number)
        if not is_valid:
            raise ValidationError(result or "Invalid phone number format")
        
        formatted_phone = result
        
        try:
            from twilio.rest import Client
            from app.common.config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
            
            if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_VERIFY_SERVICE_SID:
                raise ValidationError("Twilio is not configured. Please contact support.")
            
            # Initialize Twilio client
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            
            # Verify the code
            verification_check = client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID) \
                .verification_checks \
                .create(to=formatted_phone, code=code)
            
            is_verified = verification_check.status == 'approved'
            
            method_logger.info('Verification code checked', {
                'user_id': str(user_id),
                'phone_number': formatted_phone,
                'status': verification_check.status,
                'verified': is_verified,
                'update_user': update_user
            })
            
            if is_verified:
                user = db.query(UserModel).filter(UserModel.id == user_id).first()
                if user:
                    if update_user:
                        # First-time verification (login/registration) - update user immediately
                        # Normalize the user phone number for comparison
                        user_phone_normalized = None
                        try:
                            if user.phone_number:
                                is_valid_user_phone, user_phone_normalized = PhoneVerificationService.validate_phone_number(user.phone_number)
                                if not is_valid_user_phone:
                                    user_phone_normalized = None
                        except:
                            user_phone_normalized = None
                        
                        # Check if phones match (comparing normalized versions)
                        phones_match = (
                            (user.phone_number and user.phone_number == formatted_phone) or 
                            (user.phone_number and user.phone_number == phone_number) or
                            (user_phone_normalized and user_phone_normalized == formatted_phone)
                        )
                        
                        # Always update verification status since Twilio verified it
                        user.phone_verified = True
                        user.phone_verified_at = datetime.now(timezone.utc)
                        
                        # If phone numbers don't match, update the user phone to the verified one
                        if not phones_match:
                            method_logger.info('Phone number updated to verified format', {
                                'user_id': str(user_id),
                                'old_phone': user.phone_number,
                                'new_phone': formatted_phone
                            })
                            user.phone_number = formatted_phone
                        else:
                            method_logger.info('Phone number verified - updating user', {
                                'user_id': str(user_id),
                                'phone_number': formatted_phone,
                                'user_phone': user.phone_number
                            })
                        
                        db.commit()
                    else:
                        # Settings page change - update phone_verified_at to track verification time
                        # Don't update phone_number or phone_verified flag yet
                        # The phone will be updated when user saves the form
                        # We update phone_verified_at as a timestamp to indicate recent verification
                        user.phone_verified_at = datetime.now(timezone.utc)
                        db.commit()
                        
                        method_logger.info('Phone verification completed (not saved to user yet)', {
                            'user_id': str(user_id),
                            'phone_number': formatted_phone
                        })
                else:
                    # User doesn't exist - this shouldn't happen, but log it
                    method_logger.warning('User not found during verification', {
                        'user_id': str(user_id),
                        'phone_number': formatted_phone
                    })
            
            return {
                'verified': is_verified,
                'status': verification_check.status,
                'phone_number': formatted_phone
            }
            
        except ImportError:
            raise ValidationError("Twilio library is not installed. Please contact support.")
        except Exception as e:
            method_logger.error('Failed to verify code', e, {
                'user_id': str(user_id),
                'phone_number': formatted_phone
            })
            raise ValidationError(f"Failed to verify code: {str(e)}")
    
    #---------------------------------
    # Check Phone Verification Status
    #---------------------------------
    @staticmethod
    def get_phone_verification_status(
        db: Session,
        user_id: UUID
    ) -> dict:
        """Get the phone verification status for a user"""
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        
        if not user:
            return {
                'phone_verified': False,
                'phone_verified_at': None,
                'phone_number': None
            }
        
        return {
            'phone_verified': user.phone_verified or False,
            'phone_verified_at': user.phone_verified_at.isoformat() if user.phone_verified_at else None,
            'phone_number': user.phone_number
        }
    
    #---------------------------------
    # Check if Phone Changed and Needs Verification
    #---------------------------------
    @staticmethod
    def phone_changed_and_needs_verification(
        db: Session,
        user_id: UUID,
        new_phone_number: str,
        organization_id: UUID
    ) -> bool:
        """
        Check if the phone number changed and needs verification
        Returns True if phone changed and org requires verification
        """
        # Check if organization requires verification
        if not PhoneVerificationService.organization_requires_verification(db, organization_id):
            return False
        
        # Get current user
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if not user:
            # New user - needs verification
            return True
        
        # Validate and format both numbers for comparison
        is_valid_old = False
        formatted_old = None
        if user.phone_number:
            is_valid_old, formatted_old = PhoneVerificationService.validate_phone_number(user.phone_number)
        
        is_valid_new, formatted_new = PhoneVerificationService.validate_phone_number(new_phone_number)
        
        if not is_valid_new:
            return False  # Invalid new number, will be caught by validation
        
        # Compare formatted numbers
        old_phone = formatted_old if (is_valid_old and formatted_old) else user.phone_number
        new_phone = formatted_new
        
        # Check if this is first-time phone addition (user had no phone before)
        is_first_time_addition = not user.phone_number or not user.phone_number.strip()
        
        # Phone changed if numbers don't match
        phone_changed = old_phone != new_phone if old_phone else True
        
        # Needs verification if:
        # 1. Phone changed from an existing number (not first-time addition)
        # 2. OR current phone is not verified (but only if phone exists)
        if is_first_time_addition:
            # First-time addition - no verification needed at this stage
            # User will verify later through the verify-phone page flow
            needs_verification = False
        else:
            # Changing existing phone - needs verification
            needs_verification = phone_changed or not user.phone_verified
        
        return needs_verification

