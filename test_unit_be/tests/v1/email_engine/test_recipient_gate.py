"""Recipient deliverability gate for internal placeholder emails."""

from app.v1.email_engine.recipient_gate import (
    BLOCKED_PLACEHOLDER_EMAIL_REASON,
    is_non_deliverable_recipient_email,
)


def test_placeholder_suffix_is_non_deliverable():
    assert is_non_deliverable_recipient_email("ali-smith@internal.invalid") is True
    assert is_non_deliverable_recipient_email("ALI@INTERNAL.INVALID") is True


def test_real_email_is_deliverable():
    assert is_non_deliverable_recipient_email("ali@gmail.com") is False


def test_empty_email_is_non_deliverable():
    assert is_non_deliverable_recipient_email(None) is True
    assert is_non_deliverable_recipient_email("") is True
    assert is_non_deliverable_recipient_email("   ") is True


def test_blocked_reason_mentions_not_delivered():
    assert "not delivered" in BLOCKED_PLACEHOLDER_EMAIL_REASON.lower()
    assert "@internal.invalid" in BLOCKED_PLACEHOLDER_EMAIL_REASON
