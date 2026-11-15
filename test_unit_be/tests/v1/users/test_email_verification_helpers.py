"""Unit tests for EmailVerificationService helpers (no live email)."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.v1.users.email_verification_service import EmailVerificationService


def test_validate_email_accepts_and_normalizes():
    ok, normalized = EmailVerificationService.validate_email("  User@Example.COM ")
    assert ok is True
    assert normalized == "user@example.com"


def test_validate_email_rejects_invalid():
    ok, err = EmailVerificationService.validate_email("not-an-email")
    assert ok is False
    assert err


def test_email_already_exists_true_when_found():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=uuid4())
    assert EmailVerificationService.email_already_exists(db, "a@example.com") is True


def test_email_already_exists_false_when_missing():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    assert EmailVerificationService.email_already_exists(db, "a@example.com") is False


def test_email_already_exists_excludes_user():
    db = MagicMock()
    query = MagicMock()
    db.query.return_value.filter.return_value = query
    query.filter.return_value.first.return_value = None

    exclude_id = uuid4()
    assert (
        EmailVerificationService.email_already_exists(
            db, "a@example.com", exclude_user_id=exclude_id
        )
        is False
    )
    query.filter.assert_called_once()


def test_generate_verification_code_persists_six_digits():
    db = MagicMock()
    user_id = uuid4()

    with patch(
        "app.v1.users.email_verification_service.EmailVerificationCode"
    ) as model_cls:
        code = EmailVerificationService._generate_verification_code(
            db, user_id, "a@example.com"
        )

    assert len(code) == 6
    assert code.isdigit()
    db.add.assert_called_once()
    db.flush.assert_called_once()
    kwargs = model_cls.call_args.kwargs
    assert kwargs["user_id"] == user_id
    assert kwargs["code"] == code
    assert isinstance(kwargs["expires_at"], datetime)
    assert kwargs["expires_at"].tzinfo == timezone.utc
