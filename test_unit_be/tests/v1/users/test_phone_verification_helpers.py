"""Unit tests for PhoneVerificationService pure helpers (no Twilio)."""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from app.v1.users.phone_verification_service import PhoneVerificationService


def test_validate_phone_number_requires_value():
    ok, err = PhoneVerificationService.validate_phone_number("")
    assert ok is False
    assert "required" in err.lower()


def test_validate_phone_number_accepts_e164_us_number():
    ok, formatted = PhoneVerificationService.validate_phone_number("+1 (415) 555-2671")
    assert ok is True
    assert formatted.startswith("+")
    assert formatted[1:].isdigit()


def test_validate_phone_number_rejects_invalid():
    ok, err = PhoneVerificationService.validate_phone_number("+999999")
    assert ok is False
    assert err


def test_organization_requires_verification_missing_org():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    assert (
        PhoneVerificationService.organization_requires_verification(db, uuid4())
        is False
    )


def test_organization_requires_verification_reads_flag():
    org = SimpleNamespace(enforce_phone_validation=True)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = org
    assert (
        PhoneVerificationService.organization_requires_verification(db, uuid4())
        is True
    )

    org.enforce_phone_validation = False
    assert (
        PhoneVerificationService.organization_requires_verification(db, uuid4())
        is False
    )
