"""Unit tests for auth RegisterRequest validators."""

import pytest
from pydantic import ValidationError

from app.v1.auth.schema import RegisterRequest


def _valid(**overrides):
    payload = {
        "email": "jane@example.com",
        "password": "SecurePass1!",
        "first_name": "jane",
        "last_name": "doe",
        "org_domain": "school.example.com",
    }
    payload.update(overrides)
    return RegisterRequest(**payload)


def test_register_request_normalizes_email_and_names():
    req = _valid(email="  Jane@Example.COM ", first_name="jane marie", last_name="o'neil")
    assert req.email == "jane@example.com"
    assert req.first_name == "Jane Marie"
    assert req.last_name == "O'Neil"


def test_register_request_rejects_weak_password():
    with pytest.raises(ValidationError, match="uppercase|lowercase|digit|special"):
        _valid(password="weakpass")


def test_register_request_rejects_invalid_name_chars():
    with pytest.raises(ValidationError, match="letters"):
        _valid(first_name="Jane123")


def test_register_request_normalizes_optional_phone():
    req = _valid(phone_number="+1 (415) 555-2671")
    assert req.phone_number.startswith("+")
