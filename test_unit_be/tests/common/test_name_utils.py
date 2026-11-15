"""Unit tests for person-name casing normalization and length validation."""

import pytest
from pydantic import ValidationError

from app.common.name_utils import (
    PERSON_NAME_TOO_SHORT_MESSAGE,
    count_person_name_letters,
    normalize_person_name,
    normalize_required_person_name,
)
from app.v1.auth.schema import RegisterRequest
from app.v1.users.schema import User, UserCreate, UserUpdate
from uuid import uuid4


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("john", "John"),
        ("JOHN", "John"),
        ("jOhN dOe", "John Doe"),
        ("  mary-jane  ", "Mary-Jane"),
        ("o'brien", "O'Brien"),
        ("MARY-JANE O'BRIEN", "Mary-Jane O'Brien"),
        ("", ""),
        ("   ", ""),
        (None, ""),
    ],
)
def test_normalize_person_name(raw, expected):
    assert normalize_person_name(raw) == expected


def test_count_person_name_letters():
    assert count_person_name_letters("A") == 1
    assert count_person_name_letters("Jo") == 2
    assert count_person_name_letters("K.") == 1
    assert count_person_name_letters(".") == 0


def test_normalize_required_person_name_rejects_single_letter():
    with pytest.raises(ValueError, match="two letters"):
        normalize_required_person_name("A")
    assert normalize_required_person_name("Jo") == "Jo"


def test_register_request_normalizes_names():
    req = RegisterRequest(
        email="User@Example.COM",
        password="SecurePass1!",
        first_name="john",
        last_name="DOE",
        org_domain="example.com",
    )
    assert req.first_name == "John"
    assert req.last_name == "Doe"
    assert req.email == "user@example.com"


def test_register_request_rejects_single_letter_name():
    with pytest.raises(ValidationError) as exc:
        RegisterRequest(
            email="user@example.com",
            password="SecurePass1!",
            first_name="A",
            last_name="Doe",
            org_domain="example.com",
        )
    assert PERSON_NAME_TOO_SHORT_MESSAGE in str(exc.value)


def test_user_create_normalizes_names():
    user = UserCreate(
        email="a@example.com",
        first_name="jane",
        last_name="smith",
        organization_id=uuid4(),
        password="SecurePass1!",
    )
    assert user.first_name == "Jane"
    assert user.last_name == "Smith"


def test_user_create_rejects_single_letter_name():
    with pytest.raises(ValidationError) as exc:
        UserCreate(
            email="a@example.com",
            first_name="A",
            last_name="Bee",
            organization_id=uuid4(),
            password="SecurePass1!",
        )
    assert PERSON_NAME_TOO_SHORT_MESSAGE in str(exc.value)


def test_user_update_normalizes_optional_names():
    user = UserUpdate(
        email="a@example.com",
        first_name="jane",
        last_name=None,
        organization_id=uuid4(),
    )
    assert user.first_name == "Jane"
    assert user.last_name is None


def test_user_update_rejects_single_letter_name():
    with pytest.raises(ValidationError) as exc:
        UserUpdate(first_name="A", last_name="Bee")
    assert PERSON_NAME_TOO_SHORT_MESSAGE in str(exc.value)


def test_user_response_allows_single_letter_legacy_names():
    """GET /users/me builds ``User`` from DB; short legacy names must not 422."""
    org_id = uuid4()
    user = User(
        id=uuid4(),
        email="legacy@example.com",
        first_name="A",
        last_name="B",
        organization_id=org_id,
        organization_name="Org",
        organization_domain="org.test",
        roles=["user"],
    )
    assert user.first_name == "A"
    assert user.last_name == "B"
