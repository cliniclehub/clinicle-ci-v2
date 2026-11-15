"""Unit tests for OAuth display-name fallback parsing."""

import pytest

from app.v1.auth.services import _names_from_oauth_claims


@pytest.mark.parametrize(
    "raw,expected",
    [
        (
            {"given_name": "Jane", "family_name": "Doe", "name": "Jane Doe"},
            ("Jane", "Doe"),
        ),
        (
            {"given_name": "Jane", "family_name": "", "name": "Jane Doe"},
            ("Jane", "Doe"),
        ),
        (
            {"given_name": "Jane", "name": "Jane Doe"},
            ("Jane", "Doe"),
        ),
        (
            {"given_name": "Jane Marie", "name": "Jane Marie Doe"},
            ("Jane Marie", "Doe"),
        ),
        (
            {"name": "Jane Doe"},
            ("Jane", "Doe"),
        ),
        (
            {"name": "Jane Marie Doe"},
            ("Jane", "Marie Doe"),
        ),
        (
            {"given_name": "Jane", "name": "Jane"},
            ("Jane", ""),
        ),
        (
            {"name": "Madonna"},
            ("Madonna", ""),
        ),
        (
            {"given_name": "  Jane  ", "family_name": "  Doe  "},
            ("Jane", "Doe"),
        ),
        (
            {},
            ("", ""),
        ),
    ],
)
def test_names_from_oauth_claims(raw, expected):
    assert _names_from_oauth_claims(raw) == expected
