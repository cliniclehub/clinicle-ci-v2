"""Unit tests for OAuth password-login guidance copy."""

from app.v1.auth.services import _oauth_login_guidance_message


def test_empty_providers_returns_empty_string():
    assert _oauth_login_guidance_message([], oauth_only=True) == ""
    assert _oauth_login_guidance_message([], oauth_only=False) == ""


def test_oauth_only_google_uses_google_specific_copy():
    msg = _oauth_login_guidance_message(["google"], oauth_only=True)
    assert "Google sign-in" in msg
    assert "Sign in with Google" in msg


def test_oauth_only_other_provider_uses_generic_matching_option():
    msg = _oauth_login_guidance_message(["microsoft"], oauth_only=True)
    assert "Microsoft" in msg
    assert "matching sign-in option" in msg


def test_oauth_only_multiple_providers_lists_names():
    msg = _oauth_login_guidance_message(["google", "apple"], oauth_only=True)
    assert "Google" in msg
    assert "Apple" in msg
    assert "matching sign-in option" in msg


def test_password_plus_oauth_mentions_invalid_password_and_link():
    msg = _oauth_login_guidance_message(["google"], oauth_only=False)
    assert "Invalid password" in msg
    assert "Google" in msg
