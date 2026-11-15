"""
Dry-run email provider — logs outbound mail without calling a delivery API.
"""

from __future__ import annotations

from typing import Any, Dict, List
from uuid import uuid4

from app.common.app_logger import get_logger
from app.common.email_providers.base import (
    BaseEmailProvider,
    EmailMessage,
    EmailSendResult,
)


class LoggingEmailProvider(BaseEmailProvider):
    """Records successful sends locally when EMAIL_DELIVERY_ENABLED is false."""

    def __init__(self, config: Dict[str, Any] | None = None):
        super().__init__(config or {})
        self.class_logger = get_logger(__name__)

    def validate_config(self) -> None:
        return None

    def send_email(self, message: EmailMessage) -> EmailSendResult:
        method_logger = self.class_logger.get_method_logger("send_email")
        message_id = f"dry-run-{uuid4()}"
        recipients = [address.email for address in (message.to or [])]
        method_logger.info(
            "Email delivery disabled — logged without provider send",
            extra={
                "message_id": message_id,
                "to": recipients,
                "subject": message.subject,
                "from_email": message.from_email.email if message.from_email else None,
            },
        )
        return EmailSendResult(
            success=True,
            message_id=message_id,
            provider_response={
                "dry_run": True,
                "provider": "logging",
                "to": recipients,
            },
        )

    def send_bulk_email(self, messages: List[EmailMessage]) -> List[EmailSendResult]:
        return [self.send_email(message) for message in messages]

    def verify_connection(self) -> bool:
        return True
