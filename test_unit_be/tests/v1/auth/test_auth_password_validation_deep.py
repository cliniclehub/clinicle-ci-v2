"""Auth2Service password validation / cleanup / reset email helpers."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import BusinessException, ValidationError
from app.v1.auth.services import Auth2Service


def _q(result=None, *, all_rows=None, count=0):
    q = MagicMock()
    q.filter.return_value = q
    q.filter_by.return_value = q
    q.order_by.return_value = q
    q.limit.return_value = q
    q.offset.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    q.count.return_value = count
    q.delete.return_value = 1
    return q


def test_validate_and_update_password_branches():
    async def _run():
        db = MagicMock()
        svc = Auth2Service(db)

        # oauth-only no password
        user = SimpleNamespace(
            id=uuid4(),
            email="a@example.com",
            password_hash=None,
            must_change_password=False,
        )
        db.query.return_value = _q(all_rows=[SimpleNamespace(provider="google")])
        with pytest.raises(ValidationError, match="Google|provider|no password"):
            await svc._validate_and_update_password(
                user=user,
                new_password="NewPass1!",
                current_password="x",
                require_current_password=True,
            )

        # wrong current password
        user2 = SimpleNamespace(
            id=uuid4(),
            email="a@example.com",
            password_hash="hash",
            must_change_password=True,
        )
        with (
            patch("app.v1.auth.services.verify_password", return_value=False),
            pytest.raises(ValidationError, match="incorrect"),
        ):
            await svc._validate_and_update_password(
                user=user2,
                new_password="NewPass1!",
                current_password="bad",
                require_current_password=True,
            )

        # reused password
        def verify_side(plain, hashed):
            if plain == "OldPass1!":
                return True
            return False

        with (
            patch("app.v1.auth.services.verify_password", side_effect=verify_side),
            patch.object(svc, "_is_password_reused", new=AsyncMock(return_value=True)),
            pytest.raises(ValidationError, match="recently"),
        ):
            await svc._validate_and_update_password(
                user=user2,
                new_password="BrandNew1!",
                current_password="OldPass1!",
                require_current_password=True,
            )

        # happy path first password (no history)
        user3 = SimpleNamespace(
            id=uuid4(),
            email="a@example.com",
            password_hash=None,
            must_change_password=True,
        )
        with (
            patch("app.v1.auth.services.hash_password", return_value="newhash"),
            patch.object(svc, "_is_password_reused", new=AsyncMock(return_value=False)),
            patch.object(svc, "_cleanup_user_password_history", new=AsyncMock()),
            patch.object(svc, "_send_password_change_confirmation_email", new=AsyncMock()),
        ):
            await svc._validate_and_update_password(
                user=user3,
                new_password="BrandNew1!",
                require_current_password=False,
                commit=False,
            )
        assert user3.password_hash == "newhash"
        db.flush.assert_called()

        # unexpected error -> BusinessException
        user4 = SimpleNamespace(
            id=uuid4(), email="a@example.com", password_hash="h", must_change_password=False
        )
        with (
            patch("app.v1.auth.services.verify_password", side_effect=RuntimeError("boom")),
            pytest.raises(BusinessException),
        ):
            await svc._validate_and_update_password(
                user=user4,
                new_password="BrandNew1!",
                require_current_password=False,
            )

    return asyncio.run(_run())




def test_get_login_statistics_basic():
    async def _run():
        uid = uuid4()
        user = SimpleNamespace(
            id=uid,
            email="a@example.com",
            organization_id=uuid4(),
            organization=SimpleNamespace(name="Org"),
            last_successful_login_at=None,
        )
        db = MagicMock()
        call = {"n": 0}

        def side(*_a, **_k):
            call["n"] += 1
            if call["n"] == 1:
                return _q(user)
            return _q(count=3, all_rows=[])

        db.query.side_effect = side
        stats = await Auth2Service(db).get_user_login_statistics(uid, days=30)
        assert stats is not None

    return asyncio.run(_run())
