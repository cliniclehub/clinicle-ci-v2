"""Auth2Service build_user_info and lock helper coverage."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.v1.auth.services import Auth2Service


def _q(result=None, *, all_rows=None):
    q = MagicMock()
    q.filter.return_value = q
    q.join.return_value = q
    q.order_by.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    return q


def test_build_user_info_includes_roles_and_org():
    db = MagicMock()
    role = SimpleNamespace(key="org_admin")
    db.query.return_value = _q(all_rows=[role])
    svc = Auth2Service(db)
    uid = uuid4()
    oid = uuid4()
    now = datetime.now(timezone.utc)
    user = SimpleNamespace(
        id=uid,
        email="u@example.com",
        first_name="U",
        last_name="Ser",
        email_verified=True,
        email_verified_at=now,
        must_change_password=False,
        locked=False,
        created_at=now,
        updated_at=now,
    )
    org = SimpleNamespace(id=oid, name="Org", domain="org.test")
    with patch(
        "app.v1.roles.permission_bootstrap.ensure_permission_catalog"
    ), patch(
        "app.v1.roles.permission_bootstrap.resolve_permission_keys_for_user_roles",
        return_value=["org.users.read"],
    ):
        info = svc.build_user_info(user, org)
    assert info.email == "u@example.com"
    assert "org_admin" in info.roles
    assert info.organization_id == oid
    assert "org.users.read" in info.permissions


def test_login_attempts_filters_for_user():
    db = MagicMock()
    svc = Auth2Service(db)
    user = SimpleNamespace(id=uuid4(), organization_id=uuid4(), email="a@example.com")
    clause = svc._login_attempts_filters_for_user(user, datetime.now(timezone.utc))
    assert clause is not None
