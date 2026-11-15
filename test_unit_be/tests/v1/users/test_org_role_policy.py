"""Org assignable role policy tests."""

from uuid import uuid4
from unittest.mock import MagicMock

import pytest

from app.common.business_exceptions import AuthorizationError
from app.v1.users.org_role_policy import (
    assert_caller_may_assign_roles,
    assert_org_assignable_roles,
    assert_org_cannot_manage_org_owner,
)


def test_assert_rejects_platform_role():
    db = MagicMock()
    role = MagicMock()
    role.key = "super_admin"
    role.is_system = True
    role.organization_id = None
    db.query.return_value.filter.return_value.all.return_value = [role]
    with pytest.raises(AuthorizationError):
        assert_org_assignable_roles(
            ["user", "super_admin"],
            db=db,
            organization_id=uuid4(),
        )


def test_assert_allows_system_org_roles_when_present():
    db = MagicMock()
    org_id = uuid4()
    roles = []
    for key in ("user", "org_admin"):
        role = MagicMock()
        role.key = key
        role.is_system = True
        role.organization_id = None
        roles.append(role)
    db.query.return_value.filter.return_value.all.return_value = roles
    assert (
        assert_org_assignable_roles(["user", "org_admin"], db=db, organization_id=org_id)
        is None
    )


def test_assert_allows_empty():
    db = MagicMock()
    org_id = uuid4()
    assert assert_org_assignable_roles(None, db=db, organization_id=org_id) is None
    assert assert_org_assignable_roles([], db=db, organization_id=org_id) is None


def test_org_admin_cannot_assign_org_admin():
    with pytest.raises(AuthorizationError, match="Only Organization Owners"):
        assert_caller_may_assign_roles(["org_admin"], ["user", "org_admin"])


def test_org_owner_can_assign_org_admin():
    assert assert_caller_may_assign_roles(["org_owner"], ["user", "org_admin"]) is None


def test_org_admin_cannot_edit_existing_org_admin_roles():
    with pytest.raises(AuthorizationError, match="Only Organization Owners"):
        assert_caller_may_assign_roles(["org_admin"], ["user"], ["org_admin"])


def test_org_admin_can_assign_user_role():
    assert assert_caller_may_assign_roles(["org_admin"], ["user"]) is None


def test_cannot_manage_org_owner_account():
    with pytest.raises(AuthorizationError, match="platform administration"):
        assert_org_cannot_manage_org_owner(["org_owner", "user"])


def test_can_manage_non_owner_account():
    assert assert_org_cannot_manage_org_owner(["org_admin", "user"]) is None
    assert assert_org_cannot_manage_org_owner(["user"]) is None
    assert assert_org_cannot_manage_org_owner(None) is None
