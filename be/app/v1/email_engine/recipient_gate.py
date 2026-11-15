"""Recipient deliverability gate for outbound email.

Internal or provisioned accounts may use synthetic addresses ending in
``@internal.invalid``. Those must never hit the email provider. Callers still
run through the engine so we can record a blocked log entry and prove the
notification pipeline fired.
"""

from __future__ import annotations

from typing import Optional

PLACEHOLDER_RECIPIENT_EMAIL_SUFFIX = "@internal.invalid"
BLOCKED_PLACEHOLDER_EMAIL_REASON = (
    "Blocked: recipient is an internal placeholder email "
    f"(*{PLACEHOLDER_RECIPIENT_EMAIL_SUFFIX}); not delivered to provider"
)


def is_non_deliverable_recipient_email(email: Optional[str]) -> bool:
    """True when the address is empty or an internal placeholder."""
    if not email or not str(email).strip():
        return True
    return str(email).strip().lower().endswith(PLACEHOLDER_RECIPIENT_EMAIL_SUFFIX)
