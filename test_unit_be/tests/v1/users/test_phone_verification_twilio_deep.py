"""PhoneVerificationService Twilio send/verify paths with config patches."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import ValidationError
from app.v1.users.phone_verification_service import PhoneVerificationService


def _run(coro):
    return asyncio.run(coro)


def _q(result=None):
    q = MagicMock()
    q.filter.return_value = q
    q.first.return_value = result
    return q


def _silent_logger():
    ml = MagicMock()
    return MagicMock(get_method_logger=MagicMock(return_value=ml))


def test_validate_phone_import_fallback():
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "phonenumbers" or (isinstance(name, str) and name.startswith("phonenumbers")):
            raise ImportError("no phonenumbers")
        return real_import(name, *a, **k)

    with patch("builtins.__import__", side_effect=fake_import):
        ok, val = PhoneVerificationService.validate_phone_number("+12025550123")
        assert ok is True and val.startswith("+")
        bad, _err = PhoneVerificationService.validate_phone_number("+12")
        assert bad is False


def test_send_and_verify_code_twilio_success_and_failures():
    uid, oid = uuid4(), uuid4()
    db = MagicMock()

    twilio = MagicMock()
    twilio.verify.v2.services.return_value.verifications.create.return_value = (
        SimpleNamespace(sid="VE1", status="pending")
    )
    twilio.verify.v2.services.return_value.verification_checks.create.return_value = (
        SimpleNamespace(status="approved")
    )

    with (
        patch.object(
            PhoneVerificationService,
            "organization_requires_verification",
            return_value=True,
        ),
        patch.object(
            PhoneVerificationService,
            "validate_phone_number",
            return_value=(True, "+12025550123"),
        ),
        patch("twilio.rest.Client", return_value=twilio),
        patch("app.common.config.TWILIO_ACCOUNT_SID", "ACxxx"),
        patch("app.common.config.TWILIO_AUTH_TOKEN", "tok"),
        patch("app.common.config.TWILIO_VERIFY_SERVICE_SID", "VAxxx"),
        patch("app.v1.users.phone_verification_service.logger", _silent_logger()),
    ):
        sent = _run(
            PhoneVerificationService.send_verification_code(
                db, uid, "+12025550123", oid
            )
        )
        assert sent["verification_sid"] == "VE1"
        assert sent["status"] == "pending"

        # ValidationError for missing config is caught by broad except and rewrapped
        with (
            patch("app.common.config.TWILIO_ACCOUNT_SID", None),
            patch("app.common.config.TWILIO_AUTH_TOKEN", None),
            patch("app.common.config.TWILIO_VERIFY_SERVICE_SID", None),
            pytest.raises(ValidationError, match="Failed to send|not configured"),
        ):
            _run(
                PhoneVerificationService.send_verification_code(
                    db, uid, "+12025550123", oid
                )
            )

        with (
            patch("twilio.rest.Client", side_effect=ImportError("no twilio")),
            pytest.raises(ValidationError, match="not installed"),
        ):
            _run(
                PhoneVerificationService.send_verification_code(
                    db, uid, "+12025550123", oid
                )
            )

        user = SimpleNamespace(
            id=uid,
            phone_number="+19999999999",
            phone_verified=False,
            phone_verified_at=None,
        )
        db2 = MagicMock()
        db2.query.return_value = _q(user)
        with patch.object(
            PhoneVerificationService,
            "validate_phone_number",
            side_effect=[
                (True, "+12025550123"),
                (True, "+19999999999"),
            ],
        ):
            verified = _run(
                PhoneVerificationService.verify_code(
                    db2, uid, "+12025550123", "123456", oid, update_user=True
                )
            )
            assert verified["verified"] is True
            assert user.phone_verified is True
            assert user.phone_number == "+12025550123"
            assert db2.commit.called

        user2 = SimpleNamespace(
            id=uid,
            phone_number="+12025550123",
            phone_verified=False,
            phone_verified_at=None,
        )
        db3 = MagicMock()
        db3.query.return_value = _q(user2)
        out = _run(
            PhoneVerificationService.verify_code(
                db3, uid, "+12025550123", "123456", oid, update_user=False
            )
        )
        assert out["verified"] is True
        assert user2.phone_verified_at is not None
        assert user2.phone_verified is False

        db4 = MagicMock()
        db4.query.return_value = _q(None)
        out2 = _run(
            PhoneVerificationService.verify_code(
                db4, uid, "+12025550123", "123456", oid
            )
        )
        assert out2["verified"] is True

        twilio.verify.v2.services.return_value.verification_checks.create.return_value = (
            SimpleNamespace(status="pending")
        )
        db5 = MagicMock()
        db5.query.return_value = _q(user2)
        pending = _run(
            PhoneVerificationService.verify_code(
                db5, uid, "+12025550123", "000000", oid
            )
        )
        assert pending["verified"] is False

        with (
            patch("twilio.rest.Client", side_effect=RuntimeError("twilio down")),
            pytest.raises(ValidationError, match="Failed to verify"),
        ):
            _run(
                PhoneVerificationService.verify_code(
                    db, uid, "+12025550123", "123456", oid
                )
            )


def test_phone_changed_and_status_branches():
    oid = uuid4()
    uid = uuid4()
    db = MagicMock()

    with patch.object(
        PhoneVerificationService,
        "organization_requires_verification",
        return_value=False,
    ):
        assert (
            PhoneVerificationService.phone_changed_and_needs_verification(
                db, uid, "+12025550123", oid
            )
            is False
        )

    with patch.object(
        PhoneVerificationService,
        "organization_requires_verification",
        return_value=True,
    ):
        db.query.return_value = _q(None)
        assert (
            PhoneVerificationService.phone_changed_and_needs_verification(
                db, uid, "+12025550123", oid
            )
            is True
        )

        user = SimpleNamespace(phone_number=None, phone_verified=False)
        db.query.return_value = _q(user)
        assert (
            PhoneVerificationService.phone_changed_and_needs_verification(
                db, uid, "+12025550123", oid
            )
            is False
        )

        user2 = SimpleNamespace(phone_number="+12025550123", phone_verified=True)
        db.query.return_value = _q(user2)
        with patch.object(
            PhoneVerificationService,
            "validate_phone_number",
            side_effect=[(True, "+12025550123"), (True, "+12025550999")],
        ):
            assert (
                PhoneVerificationService.phone_changed_and_needs_verification(
                    db, uid, "+12025550999", oid
                )
                is True
            )

        with patch.object(
            PhoneVerificationService,
            "validate_phone_number",
            return_value=(False, "bad"),
        ):
            assert (
                PhoneVerificationService.phone_changed_and_needs_verification(
                    db, uid, "bad", oid
                )
                is False
            )

    db.query.return_value = _q(None)
    status = PhoneVerificationService.get_phone_verification_status(db, uid)
    assert status["phone_verified"] is False

    now = datetime.now(timezone.utc)
    db.query.return_value = _q(
        SimpleNamespace(
            phone_verified=True,
            phone_verified_at=now,
            phone_number="+12025550123",
        )
    )
    status2 = PhoneVerificationService.get_phone_verification_status(db, uid)
    assert status2["phone_verified"] is True
    assert status2["phone_number"] == "+12025550123"
