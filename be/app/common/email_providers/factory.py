"""
Email Provider Factory
Creates MailerSend provider instance, or a logging dry-run provider when delivery is disabled.
"""

from typing import Dict, Any

from app.common.config import MAILERSEND_API_KEY, is_email_delivery_enabled
from app.common.email_providers.base import BaseEmailProvider
from app.common.email_providers.logging_provider import LoggingEmailProvider
from app.common.email_providers.mailersend import MailerSendProvider


class EmailProviderFactory:
    """Factory for creating email provider instances"""

    @classmethod
    def get_provider_config(cls) -> Dict[str, Any]:
        """
        Get MailerSend configuration from config.py

        Returns:
            MailerSend configuration dictionary
        """
        return {
            "api_key": MAILERSEND_API_KEY or "",
        }

    @classmethod
    def create_provider(cls, config: Dict[str, Any] = None) -> BaseEmailProvider:
        """
        Create email provider instance.

        When EMAIL_DELIVERY_ENABLED is false, returns a logging provider that
        succeeds without calling MailerSend (queue/log DB paths still run).
        """
        if not is_email_delivery_enabled():
            return LoggingEmailProvider()

        if config is None:
            config = cls.get_provider_config()

        return MailerSendProvider(config)
