"""
Base Email Provider Interface
Allows easy switching between email providers (MailerSend, SendGrid, SES, etc.)
"""

from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class EmailAddress:
    """Email address with optional name"""
    email: str
    name: Optional[str] = None


@dataclass
class EmailAttachment:
    """Email attachment"""
    filename: str
    content: bytes
    content_type: str


@dataclass
class EmailMessage:
    """Standard email message format"""
    to: List[EmailAddress]
    subject: str
    html_body: str
    text_body: Optional[str] = None
    from_email: Optional[EmailAddress] = None
    reply_to: Optional[EmailAddress] = None
    cc: Optional[List[EmailAddress]] = None
    bcc: Optional[List[EmailAddress]] = None
    attachments: Optional[List[EmailAttachment]] = None
    custom_headers: Optional[Dict[str, str]] = None
    tags: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class EmailSendResult:
    """Result of email send operation"""
    success: bool
    message_id: Optional[str] = None
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    provider_response: Optional[Dict[str, Any]] = None


class BaseEmailProvider(ABC):
    """Abstract base class for email providers"""

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize provider with configuration

        Args:
            config: Provider-specific configuration
        """
        self.config = config
        self.validate_config()

    @abstractmethod
    def validate_config(self) -> None:
        """
        Validate provider configuration
        Raises ValueError if config is invalid
        """
        pass

    @abstractmethod
    def send_email(self, message: EmailMessage) -> EmailSendResult:
        """
        Send a single email

        Args:
            message: EmailMessage to send

        Returns:
            EmailSendResult with success status and message ID
        """
        pass

    @abstractmethod
    def send_bulk_email(self, messages: List[EmailMessage]) -> List[EmailSendResult]:
        """
        Send multiple emails (batch operation)

        Args:
            messages: List of EmailMessage objects

        Returns:
            List of EmailSendResult for each message
        """
        pass

    @abstractmethod
    def verify_connection(self) -> bool:
        """
        Test provider connection/credentials

        Returns:
            True if connection is valid, False otherwise
        """
        pass

    def get_default_from_email(self) -> Optional[EmailAddress]:
        """
        Get default from email address

        Returns:
            EmailAddress or None
        """
        email = self.config.get("default_from_email")
        name = self.config.get("default_from_name")
        return EmailAddress(email=email, name=name) if email else None
