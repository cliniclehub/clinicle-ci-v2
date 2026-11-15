import pytest

from app.common.email_validation import (
    normalize_email_address,
    parse_multi_email_search,
    validate_email_address,
)


@pytest.mark.parametrize(
    "email",
    [
        "student4@example.com.",
        "user@example.com..",
        ".user@example.com",
        "user@",
        "@example.com",
        "not-an-email",
    ],
)
def test_rejects_invalid_email_addresses(email: str):
    is_valid, error = validate_email_address(email)
    assert is_valid is False
    assert error


def test_rejects_trailing_period_with_clear_message():
    is_valid, error = validate_email_address("student4@example.com.")
    assert is_valid is False
    assert "period" in error.lower()


def test_accepts_valid_email_and_normalizes():
    is_valid, normalized = validate_email_address("  Student4@Example.COM  ")
    assert is_valid is True
    assert normalized == "student4@example.com"


def test_normalize_email_address_matches_validate():
    assert normalize_email_address("User@Example.com") == "user@example.com"


def test_parse_multi_email_search_space_delimited():
    result = parse_multi_email_search(
        "asqfish@hotmail.com farzana.musawwir@gmail.com radwae@gmail.com"
    )
    assert result == [
        "asqfish@hotmail.com",
        "farzana.musawwir@gmail.com",
        "radwae@gmail.com",
    ]


def test_parse_multi_email_search_comma_delimited():
    result = parse_multi_email_search(
        "asqfish@hotmail.com, farzana.musawwir@gmail.com,radwae@gmail.com"
    )
    assert result == [
        "asqfish@hotmail.com",
        "farzana.musawwir@gmail.com",
        "radwae@gmail.com",
    ]


def test_parse_multi_email_search_single_email_returns_none():
    assert parse_multi_email_search("asqfish@hotmail.com") is None


def test_parse_multi_email_search_name_query_returns_none():
    assert parse_multi_email_search("John Smith") is None


def test_parse_multi_email_search_dedupes_and_lowercases():
    result = parse_multi_email_search("A@B.com A@B.com; c@d.com")
    assert result == ["a@b.com", "c@d.com"]
