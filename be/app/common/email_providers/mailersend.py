"""
MailerSend Email Provider
https://www.mailersend.com/
"""

from typing import List, Dict, Any
from mailersend import MailerSendClient, EmailBuilder
from mailersend.exceptions import MailerSendError
from app.common.email_providers.base import (
    BaseEmailProvider,
    EmailMessage,
    EmailAddress,
    EmailSendResult,
)
from app.common.app_logger import get_logger


class MailerSendProvider(BaseEmailProvider):
    """MailerSend email provider implementation using official SDK"""
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.class_logger = get_logger(__name__)
        # Get API key from config parameter
        api_key = config.get('api_key', '')
        self.client = MailerSendClient(api_key=api_key)

    def validate_config(self) -> None:
        """Validate MailerSend configuration"""
        api_key = self.config.get('api_key', '')
        if not api_key:
            raise ValueError("MailerSend API key is required")

    def send_email(self, message: EmailMessage) -> EmailSendResult:
        """
        Send email via MailerSend SDK

        Args:
            message: EmailMessage to send

        Returns:
            EmailSendResult
        """
        method_logger = self.class_logger.get_method_logger("send_email")
        
        try:
            # Prepare email data for SDK
            from_email = message.from_email or self.get_default_from_email()
            if not from_email:
                raise ValueError("From email is required")

            # Create email builder
            email_builder = EmailBuilder()

            # Set from email
            email_builder.from_email(from_email.email, from_email.name or "")

            # Set recipients
            for recipient in message.to:
                email_builder.to(recipient.email, recipient.name or "")

            # Set subject and content
            email_builder.subject(message.subject)
            email_builder.html(message.html_body)
            
            if message.text_body:
                email_builder.text(message.text_body)

            # Add reply-to if provided
            if message.reply_to:
                email_builder.reply_to(message.reply_to.email, message.reply_to.name or "")

            # Add CC if provided
            if message.cc:
                for recipient in message.cc:
                    email_builder.cc(recipient.email, recipient.name or "")

            # Add BCC if provided
            if message.bcc:
                for recipient in message.bcc:
                    email_builder.bcc(recipient.email, recipient.name or "")

            # Add personalization variables if provided
            if message.metadata:
                for recipient in message.to:
                    personalization = {}
                    for key, value in message.metadata.items():
                        personalization[key] = str(value)
                    email_builder.personalize(recipient.email, personalization)

            # Build and send email using SDK
            email_request = email_builder.build()
            response = self.client.emails.send(email_request)

            # Extract message ID from response
            message_id = getattr(response, 'message_id', None) or getattr(response, 'id', None) or "unknown"
            
            method_logger.info(f"Email sent successfully via MailerSend SDK: {message_id}")

            return EmailSendResult(
                success=True,
                message_id=message_id,
                provider_response={"message_id": message_id, "response": str(response)},
            )

        except MailerSendError as e:
            method_logger.error(f"MailerSend SDK error: {str(e)}")
            return EmailSendResult(
                success=False,
                error_message=f"MailerSend error: {str(e)}",
                error_code="MAILERSEND_ERROR",
            )
        except Exception as e:
            method_logger.error(f"MailerSend unexpected error: {str(e)}")
            return EmailSendResult(
                success=False,
                error_message=f"Unexpected error: {str(e)}",
                error_code="UNEXPECTED_ERROR",
            )

    def send_bulk_email(self, messages: List[EmailMessage]) -> List[EmailSendResult]:
        """
        Send multiple emails via MailerSend SDK

        Args:
            messages: List of EmailMessage objects

        Returns:
            List of EmailSendResult
        """
        method_logger = self.class_logger.get_method_logger("send_bulk_email")
        method_logger.info(f"Sending {len(messages)} emails via MailerSend SDK")
        
        results = []
        for i, message in enumerate(messages):
            try:
                result = self.send_email(message)
                results.append(result)
                method_logger.debug(f"Email {i+1}/{len(messages)} sent: {result.success}")
            except Exception as e:
                method_logger.error(f"Failed to send email {i+1}/{len(messages)}: {str(e)}")
                results.append(EmailSendResult(
                    success=False,
                    error_message=f"Failed to send: {str(e)}",
                    error_code="BULK_SEND_ERROR"
                ))

        successful_count = sum(1 for r in results if r.success)
        method_logger.info(f"Bulk email completed: {successful_count}/{len(messages)} successful")
        
        return results

    def verify_connection(self) -> bool:
        """
        Verify MailerSend API connection using SDK

        Returns:
            True if API key is valid
        """
        method_logger = self.class_logger.get_method_logger("verify_connection")
        
        try:
            # Use SDK to verify connection by listing domains
            domains = self.client.domains.list_domains()
            method_logger.info(f"MailerSend connection verified successfully")
            return True

        except MailerSendError as e:
            method_logger.error(f"MailerSend connection verification failed: {str(e)}")
            return False
        except Exception as e:
            method_logger.error(f"Connection verification unexpected error: {str(e)}")
            return False

