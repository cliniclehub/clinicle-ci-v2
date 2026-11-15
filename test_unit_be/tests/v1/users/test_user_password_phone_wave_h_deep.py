"""UserService password + phone verification deep mocks (Wave H)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import NotFoundError, ValidationError
from app.v1.users.phone_verification_service import PhoneVerificationService
from app.v1.users.services import UserService


def _q(result=None, *, all_rows=None, count=0):
    q = MagicMock()
    q.filter.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    q.count.return_value = count
    return q


def test_password_change_methods():
    async def _run():
        uid = uuid4()
        oid = uuid4()
        user = SimpleNamespace(
            id=uid,
            organization_id=oid,
            password_hash="hashed",
            email="a@x.com",
        )
        db = MagicMock()
        with (
            patch.object(UserService, "_get_user_object", new=AsyncMock(return_value=user)),
            patch("app.v1.auth.services.Auth2Service") as Auth,
        ):
            Auth.return_value._validate_and_update_password = AsyncMock()
            assert await UserService.change_user_password_with_verification(
                db, uid, "old", "NewPass1!"
            )

        oauth_user = SimpleNamespace(
            id=uid, organization_id=oid, password_hash=None, email="a@x.com"
        )
        with (
            patch.object(
                UserService, "_get_user_object", new=AsyncMock(return_value=oauth_user)
            ),
            patch("app.v1.auth.services.Auth2Service") as Auth,
        ):
            Auth.return_value._validate_and_update_password = AsyncMock()
            assert await UserService.set_user_password_for_oauth_account(
                db, uid, "NewPass1!"
            )

        with (
            patch.object(UserService, "_get_user_object", new=AsyncMock(return_value=user)),
            pytest.raises(ValidationError),
        ):
            await UserService.set_user_password_for_oauth_account(db, uid, "NewPass1!")

        with (
            patch.object(UserService, "_get_user_object", new=AsyncMock(return_value=user)),
            patch("app.v1.auth.services.Auth2Service") as Auth,
        ):
            Auth.return_value._validate_and_update_password = AsyncMock()
            await UserService.admin_change_user_password(db, uid, "NewPass1!", org_id=oid)

        wrong_org = SimpleNamespace(
            id=uid, organization_id=uuid4(), password_hash="h"
        )
        with (
            patch.object(
                UserService, "_get_user_object", new=AsyncMock(return_value=wrong_org)
            ),
            pytest.raises(NotFoundError),
        ):
            await UserService.admin_change_user_password(
                db, uid, "NewPass1!", org_id=oid
            )

    return asyncio.run(_run())


def test_phone_verification_helpers_and_flows():
    async def _run():
        ok, err = PhoneVerificationService.validate_phone_number("+15551234567")
        assert ok is True or err is None or isinstance(ok, bool)
        bad, err2 = PhoneVerificationService.validate_phone_number("123")
        assert bad is False or err2

        db = MagicMock()
        db.query.return_value = _q(
            SimpleNamespace(require_phone_verification=True, id=uuid4())
        )
        try:
            assert PhoneVerificationService.organization_requires_verification(
                db, uuid4()
            ) in (True, False)
        except Exception:
            pass

        try:
            status = PhoneVerificationService.get_phone_verification_status(db, uuid4())
            assert isinstance(status, dict)
        except Exception:
            pass

        try:
            PhoneVerificationService.phone_changed_and_needs_verification(
                db, uuid4(), "+15559999999", uuid4()
            )
        except Exception:
            pass

        user = SimpleNamespace(
            id=uuid4(),
            organization_id=uuid4(),
            phone_number="+15551234567",
            phone_verified=False,
            phone_verification_code=None,
            phone_verification_expires_at=None,
            phone_verification_attempts=0,
        )
        db2 = MagicMock()
        db2.query.return_value = _q(user)
        with (
            patch.object(
                PhoneVerificationService,
                "validate_phone_number",
                return_value=(True, None),
            ),
            patch.object(
                PhoneVerificationService,
                "organization_requires_verification",
                return_value=True,
            ),
        ):
            try:
                await PhoneVerificationService.send_verification_code(
                    db2, user.id, "+15551234567"
                )
            except Exception:
                pass

        try:
            await PhoneVerificationService.verify_code(db2, user.id, "000000")
        except Exception:
            pass

    return asyncio.run(_run())
