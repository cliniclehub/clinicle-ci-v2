"""Tests for log redaction helpers."""

import pytest

from app.common.log_redaction import (
    redact_for_log,
    redact_header_value,
    redact_url_for_log,
)

pytestmark = pytest.mark.unit


def test_redact_for_log_masks_sensitive_keys():
    payload = {
        "email": "user@example.com",
        "password": "hunter2",
        "nested": {"access_token": "abc123", "course_id": "course-1"},
        "presignedUrl": "https://cdn.example.com/orgs/1/media/a?token=secret",
        "code": "123456",
    }

    redacted = redact_for_log(payload)

    assert redacted["email"] == "user@example.com"
    assert redacted["password"] == "[REDACTED]"
    assert redacted["nested"]["access_token"] == "[REDACTED]"
    assert redacted["nested"]["course_id"] == "course-1"
    assert redacted["presignedUrl"] == "[REDACTED]"
    assert redacted["code"] == "[REDACTED]"


def test_redact_header_value_fully_redacts_authorization():
    assert redact_header_value("Authorization", "Bearer abcdefghijklmnop") == "[REDACTED]"


def test_redact_header_value_redacts_cookie_and_session_token():
    assert redact_header_value("Cookie", "session=secret") == "[REDACTED]"
    assert redact_header_value("Session-Token", "exam-session") == "[REDACTED]"


def test_redact_url_for_log_masks_sensitive_query_params():
    url = "https://media.example.com/orgs/1/file.mp4?token=abc&expires=1&local=true"
    redacted = redact_url_for_log(url)
    assert "orgs/1/file.mp4" in redacted
    assert "abc" not in redacted
    assert "REDACTED" in redacted


def test_redact_for_log_scrubs_url_string_values():
    payload = {
        "playbackUrl": "https://cdn.example.com/x?mediaToken=secret-jwt",
        "title": "Lesson 1",
    }
    redacted = redact_for_log(payload)
    assert redacted["playbackUrl"] == "[REDACTED]"
    assert redacted["title"] == "Lesson 1"
