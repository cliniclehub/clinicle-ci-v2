"""Batch edges for org role policy (updated for permission-aware assignment)."""

from uuid import uuid4
from unittest.mock import MagicMock

import pytest

from app.common.business_exceptions import AuthorizationError
from app.v1.users.org_role_policy import assert_org_assignable_roles


def _roles_for_keys(keys):
    rows = []
    for key in keys:
        role = MagicMock()
        role.key = key
        role.is_system = key in {"super_admin", "org_admin", "user"}
        role.organization_id = None if role.is_system else uuid4()
        rows.append(role)
    return rows


def test_assert_org_assignable_roles():
    db = MagicMock()
    org_id = uuid4()
    db.query.return_value.filter.return_value.all.return_value = []
    assert_org_assignable_roles(None, db=db, organization_id=org_id)
    assert_org_assignable_roles([], db=db, organization_id=org_id)

    db.query.return_value.filter.return_value.all.return_value = _roles_for_keys(
        ["org_admin", "user"]
    )
    assert_org_assignable_roles(["org_admin", "user"], db=db, organization_id=org_id)

    db.query.return_value.filter.return_value.all.return_value = _roles_for_keys(
        ["super_admin"]
    )
    with pytest.raises(AuthorizationError):
        assert_org_assignable_roles(["super_admin"], db=db, organization_id=org_id)
