"""Unit tests for users schema validators."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.v1.users.schema import (
    SendEmailVerificationRequest,
    UserBase,
    VerifyEmailCodeRequest,
)


def test_user_base_normalizes_email_only():
    """UserBase is shared with response ``User``; names are not normalized here."""
    user = UserBase(
        email="  Jane.Doe@Example.COM ",
        first_name="jane",
        last_name="doe",
        organization_id=uuid4(),
    )
    assert user.email == "jane.doe@example.com"
    assert user.first_name == "jane"
    assert user.last_name == "doe"


def test_user_base_allows_single_letter_names_for_legacy_reads():
    user = UserBase(
        email="a@example.com",
        first_name="A",
        last_name="B",
        organization_id=uuid4(),
    )
    assert user.first_name == "A"
    assert user.last_name == "B"


def test_user_base_normalizes_phone_number():
    user = UserBase(
        email="a@example.com",
        first_name="Ann",
        last_name="Bee",
        organization_id=uuid4(),
        phone_number="+1 (415) 555-2671",
    )
    assert user.phone_number.startswith("+")
    assert user.phone_number[1:].isdigit()


def test_user_base_rejects_short_phone():
    with pytest.raises(ValidationError, match="short"):
        UserBase(
            email="a@example.com",
            first_name="Ann",
            last_name="Bee",
            organization_id=uuid4(),
            phone_number="+1234",
        )


def test_send_email_verification_normalizes_email():
    req = SendEmailVerificationRequest(email="  User@Example.COM ")
    assert req.email == "user@example.com"


def test_verify_email_code_requires_six_digit_code():
    with pytest.raises(ValidationError):
        VerifyEmailCodeRequest(email="a@example.com", code="123")

    ok = VerifyEmailCodeRequest(email="A@Example.com", code="123456")
    assert ok.email == "a@example.com"
    assert ok.code == "123456"
