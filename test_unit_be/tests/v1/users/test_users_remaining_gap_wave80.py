"""Users remaining service/schema gaps for 80% push."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from phonenumbers import NumberParseException
from sqlalchemy.exc import IntegrityError

from app.common.business_exceptions import BusinessException, ConflictError, ValidationError
from app.v1.users.schema import (
    SendEmailVerificationRequest,
    UserCreate,
    UserUpdate,
    VerifyEmailCodeRequest,
)
from app.v1.users.services import UserService


def _run(coro):
    return asyncio.run(coro)


def _q(result=None, *, all_rows=None, count=0):
    q = MagicMock()
    q.filter.return_value = q
    q.filter_by.return_value = q
    q.join.return_value = q
    q.options.return_value = q
    q.order_by.return_value = q
    q.offset.return_value = q
    q.limit.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    q.count.return_value = count
    return q


def test_normalize_bulk_import_phone_branches():
    assert UserService._normalize_bulk_import_phone(None) == (None, None)
    assert UserService._normalize_bulk_import_phone("  ") == (None, None)
    phone, err = UserService._normalize_bulk_import_phone("+1")
    assert phone is None and err

    with patch("phonenumbers.parse", side_effect=NumberParseException(0, "bad")):
        phone3, err3 = UserService._normalize_bulk_import_phone("+999999999999999")
        assert phone3 is None and err3

    with patch("phonenumbers.is_valid_number", return_value=False):
        phone4, err4 = UserService._normalize_bulk_import_phone("+15555550100")
        assert phone4 is None and err4


def test_email_validators():
    req = SendEmailVerificationRequest(email="  Upper@Example.COM ")
    assert "@" in req.email
    assert VerifyEmailCodeRequest(email="a@b.com", code="123456").code == "123456"


def test_bulk_create_existing_user_update_exception():
    db = MagicMock()
    oid = uuid4()
    uid = uuid4()
    existing = SimpleNamespace(
        id=uid,
        email="ann@example.com",
        organization_id=oid,
        phone_number=None,
        email_verified=False,
        email_verified_at=None,
        first_name="Ann",
        last_name="Lee",
    )
    db.query.return_value = _q(existing)
    db.rollback = MagicMock()

    with (
        patch(
            "app.v1.users.services.validate_email_address",
            return_value=(True, "ann@example.com"),
        ),
        patch.object(
            UserService, "_normalize_bulk_import_phone", return_value=("+14155552671", None)
        ),
        patch.object(
            UserService, "_parse_bulk_import_roles", return_value=(["user"], None)
        ),
        patch.object(
            UserService,
            "_update_user_roles_scoped",
            side_effect=RuntimeError("roles boom"),
        ),
    ):
        out = _run(
            UserService.bulk_create_users(
                db,
                oid,
                [
                    {
                        "email": "ann@example.com",
                        "firstName": "Ann",
                        "lastName": "Lee",
                        "password": "Str0ng!Pass",
                        "rolesFieldInRequest": True,
                        "roles": ["user"],
                        "phoneNumber": "+14155552671",
                        "markEmailVerified": True,
                    }
                ],
                uuid4(),
                skip_email_verification=True,
            )
        )
    assert out["error_count"] >= 1


def test_bulk_create_invalid_email_format_message():
    db = MagicMock()
    oid = uuid4()
    db.query.return_value = _q(None)

    with (
        patch(
            "app.v1.users.services.validate_email_address",
            return_value=(True, "bad@example.com"),
        ),
        patch.object(UserService, "_normalize_bulk_import_phone", return_value=(None, None)),
        patch.object(
            UserService, "_parse_bulk_import_roles", return_value=(["user"], None)
        ),
        patch.object(
            UserService,
            "create_user",
            new=AsyncMock(side_effect=ValidationError("email is not valid")),
        ),
    ):
        out = _run(
            UserService.bulk_create_users(
                db,
                oid,
                [
                    {
                        "email": "bad@example.com",
                        "firstName": "Bob",
                        "lastName": "Cox",
                        "password": "Str0ng!Pass",
                    }
                ],
                uuid4(),
            )
        )
    assert out["error_count"] == 1
    assert "Invalid email" in (out["results"][0].get("error") or "")


def test_create_user_email_fail_and_integrity():
    oid = uuid4()
    org = SimpleNamespace(id=oid, name="Org", domain="org.test")
    db = MagicMock()
    # existing user check -> None, then org lookup
    seq = [_q(None), _q(org)]
    db.query.side_effect = lambda *a, **k: seq.pop(0) if seq else _q(org)
    db.add = MagicMock()
    db.flush = MagicMock()
    db.commit = MagicMock()
    db.refresh = MagicMock()
    db.rollback = MagicMock()

    auth = MagicMock()
    auth._generate_verification_code = AsyncMock(return_value="123456")
    auth._send_registration_welcome_email = AsyncMock(
        side_effect=RuntimeError("smtp down")
    )

    with (
        patch("app.v1.auth.services.Auth2Service", return_value=auth),
        patch.object(UserService, "_add_user_roles_for_organization"),
        patch("app.v1.users.services.hash_password", return_value="hashed"),
        pytest.raises(BusinessException, match="welcome email"),
    ):
        _run(
            UserService.create_user(
                db,
                UserCreate(
                    email="n@example.com",
                    first_name="Ned",
                    last_name="Ull",
                    password="Str0ng!Pass1",
                    organization_id=oid,
                    roles=["user"],
                    skip_email_verification=False,
                ),
            )
        )

    db2 = MagicMock()
    db2.query.return_value = _q(None)
    db2.add = MagicMock()
    db2.flush = MagicMock(side_effect=IntegrityError("stmt", "p", Exception("dup")))
    db2.rollback = MagicMock()
    with (
        patch("app.v1.users.services.hash_password", return_value="hashed"),
        pytest.raises(ConflictError, match="already exists"),
    ):
        _run(
            UserService.create_user(
                db2,
                UserCreate(
                    email="dup@example.com",
                    first_name="Dan",
                    last_name="Ull",
                    password="Str0ng!Pass1",
                    organization_id=oid,
                    skip_email_verification=True,
                ),
            )
        )

    db3 = MagicMock()
    db3.query.return_value = _q(None)
    db3.add = MagicMock()
    db3.flush = MagicMock(side_effect=RuntimeError("db boom"))
    db3.rollback = MagicMock()
    with (
        patch("app.v1.users.services.hash_password", return_value="hashed"),
        pytest.raises(RuntimeError),
    ):
        _run(
            UserService.create_user(
                db3,
                UserCreate(
                    email="x@example.com",
                    first_name="Xen",
                    last_name="Yee",
                    password="Str0ng!Pass1",
                    organization_id=oid,
                    skip_email_verification=True,
                ),
            )
        )


def test_update_user_password_and_roles():
    uid = uuid4()
    user = SimpleNamespace(
        id=uid,
        email="old@example.com",
        phone_number=None,
        email_verified=True,
        email_verified_at=None,
        phone_verified=False,
        phone_verified_at=None,
        organization_id=uuid4(),
        first_name="Ann",
        last_name="Bee",
        password_hash="x",
    )
    db = MagicMock()
    db.query.return_value = _q(None)
    with (
        patch.object(UserService, "_get_user_object", new=AsyncMock(return_value=user)),
        patch.object(
            UserService, "get_user", new=AsyncMock(return_value=SimpleNamespace(id=uid))
        ),
        patch("app.v1.users.services.hash_password", return_value="hashed"),
        patch.object(UserService, "_update_user_roles_scoped") as upd_roles,
    ):
        _run(
            UserService.update_user(
                db, uid, UserUpdate(password="NewStr0ng!Pass", roles=["user"])
            )
        )
        assert user.password_hash == "hashed"
        upd_roles.assert_called()


def test_update_current_user_secure_strips_and_errors():
    uid = uuid4()
    db = MagicMock()

    with patch.object(
        UserService,
        "update_user",
        new=AsyncMock(return_value=SimpleNamespace(id=uid)),
    ) as upd:
        out = _run(
            UserService.update_current_user_secure(
                db,
                uid,
                UserUpdate(first_name="Ann", roles=["org_admin"], organization_id=uuid4()),
            )
        )
        assert out.id == uid
        assert upd.called

    with (
        patch.object(
            UserService, "update_user", new=AsyncMock(side_effect=RuntimeError("x"))
        ),
        pytest.raises(RuntimeError),
    ):
        _run(UserService.update_current_user_secure(db, uid, UserUpdate(first_name="Zoe")))


def test_update_current_user_secure_drops_unknown_fields():
    """Only the self-editable allow-list reaches ``update_user``."""
    uid = uuid4()
    db = MagicMock()
    secure = UserUpdate(first_name="Ann")
    forwarded: dict = {}

    with (
        patch.object(
            UserUpdate,
            "model_dump",
            return_value={
                "first_name": "Ann",
                "city": "Amman",
                "gender": "Female",
                "country": "JO",
            },
        ),
        patch(
            "app.v1.users.services.UserUpdate",
            side_effect=lambda **kw: forwarded.update(kw)
            or SimpleNamespace(**kw, model_dump=lambda **k: kw),
        ),
        patch.object(
            UserService,
            "update_user",
            new=AsyncMock(return_value=SimpleNamespace(id=uid)),
        ),
    ):
        out = _run(UserService.update_current_user_secure(db, uid, secure))
        assert out.id == uid
        assert forwarded == {"first_name": "Ann"}


def test_change_password_verification_error_path():
    uid = uuid4()
    user = SimpleNamespace(
        id=uid,
        email="a@example.com",
        password_hash="hash",
        must_change_password=True,
        organization_id=uuid4(),
    )
    db = MagicMock()
    db.rollback = MagicMock()
    with (
        patch.object(UserService, "_get_user_object", new=AsyncMock(return_value=user)),
        patch("app.v1.auth.services.verify_password", return_value=False),
        pytest.raises(Exception),
    ):
        _run(
            UserService.change_user_password_with_verification(
                db, uid, "wrong", "NewStr0ng!1"
            )
        )
    assert db.rollback.called
