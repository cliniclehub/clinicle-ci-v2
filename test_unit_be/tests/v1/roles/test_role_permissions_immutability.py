"""Unit checks for system-role immutability and custom role mix-and-match."""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.common.business_exceptions import AuthorizationError, ValidationError
from app.v1.auth.permissions import ORG_EMAIL_MANAGE, ORG_USERS_READ, PLATFORM_USERS_READ
from app.v1.roles.services import RoleService


def test_set_role_permissions_rejects_system_role():
    db = MagicMock()
    role = SimpleNamespace(id=1, is_system=True, key="org_admin")
    with pytest.raises(AuthorizationError):
        RoleService._set_role_permissions(db, role, [ORG_USERS_READ])


def test_update_custom_role_rejects_system_role():
    db = MagicMock()
    org_id = uuid4()
    role = SimpleNamespace(
        id=1,
        is_system=True,
        organization_id=None,
        key="org_admin",
        label="Organization Admin",
    )
    db.query.return_value.filter.return_value.first.return_value = role
    with pytest.raises(AuthorizationError):
        RoleService.update_custom_role(db, org_id, 1, label="Nope")


def test_delete_custom_role_rejects_system_role():
    db = MagicMock()
    org_id = uuid4()
    role = SimpleNamespace(id=1, is_system=True, organization_id=None, key="user")
    db.query.return_value.filter.return_value.first.return_value = role
    with pytest.raises(AuthorizationError):
        RoleService.delete_custom_role(db, org_id, 1)


def test_create_custom_role_rejects_platform_permissions(monkeypatch):
    db = MagicMock()
    org_id = uuid4()
    monkeypatch.setattr(
        "app.v1.roles.services.ensure_permission_catalog", lambda _db: None
    )
    db.query.return_value.filter.return_value.first.return_value = None
    with pytest.raises(ValidationError):
        RoleService.create_custom_role(
            db, org_id, "Bad Role", [ORG_USERS_READ, PLATFORM_USERS_READ]
        )


def test_create_custom_role_allows_org_mix(monkeypatch):
    db = MagicMock()
    org_id = uuid4()
    monkeypatch.setattr(
        "app.v1.roles.services.ensure_permission_catalog", lambda _db: None
    )
    db.query.return_value.filter.return_value.first.return_value = None

    created = {}

    def _add(obj):
        created["role"] = obj

    db.add.side_effect = _add

    def _set(db_sess, role, keys):
        created["keys"] = list(keys)

    monkeypatch.setattr(RoleService, "_set_role_permissions", staticmethod(_set))
    role = RoleService.create_custom_role(
        db, org_id, "User viewer + Email", [ORG_USERS_READ, ORG_EMAIL_MANAGE]
    )
    assert role.label == "User viewer + Email"
    assert role.is_system is False
    assert role.organization_id == org_id
    assert set(created["keys"]) == {ORG_USERS_READ, ORG_EMAIL_MANAGE}
