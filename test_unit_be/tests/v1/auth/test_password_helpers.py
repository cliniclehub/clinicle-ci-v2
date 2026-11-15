"""Auth password utilities."""

from app.common.auth_helper import hash_password, verify_password


def test_hash_and_verify_password_roundtrip():
    hashed = hash_password("SecurePass1!")
    assert hashed != "SecurePass1!"
    assert verify_password("SecurePass1!", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_verify_password_empty_hash():
    assert verify_password("anything", "") is False
    assert verify_password("anything", None) is False
