"""Password strength validation."""

import pytest

from app.v1.auth.schema import validate_password_strength


def test_validate_password_strength_accepts_valid_password():
    assert validate_password_strength("SecurePass1!") == "SecurePass1!"


@pytest.mark.parametrize(
    "password,match",
    [
        ("securepass1!", "uppercase"),
        ("SECUREPASS1!", "lowercase"),
        ("SecurePass!", "digit"),
        ("SecurePass1", "special character"),
    ],
)
def test_validate_password_strength_rejects_missing_requirements(password, match):
    with pytest.raises(ValueError, match=match):
        validate_password_strength(password)
