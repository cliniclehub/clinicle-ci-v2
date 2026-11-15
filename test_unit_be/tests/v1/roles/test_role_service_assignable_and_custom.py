"""RoleService assignable listing and custom-role CRUD coverage."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import (
    AuthorizationError,
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.v1.auth.org_roles import ORG_ADMIN, ORG_OWNER, USER
from app.v1.roles.services import RoleService


def _q(result=None, *, all_rows=None, count=0):
    q = MagicMock()
    q.filter.return_value = q
    q.order_by.return_value = q
    q.join.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    q.count.return_value = count
    return q


def test_list_assignable_roles_owner_vs_admin():
    db = MagicMock()
    org_id = uuid4()
    admin_role = SimpleNamespace(key=ORG_ADMIN, is_system=True)
    user_role = SimpleNamespace(key=USER, is_system=True)
    custom = SimpleNamespace(key="c_abc", is_system=False, organization_id=org_id)

    with patch("app.v1.roles.services.ensure_permission_catalog"):
        # owner gets org_admin + user + custom
        def query_side_effect(model):
            q = _q()
            name = getattr(model, "__name__", str(model))
            if "Role" in name or hasattr(model, "key"):
                # first call system, second custom — RoleService issues two queries
                if not hasattr(query_side_effect, "n"):
                    query_side_effect.n = 0
                query_side_effect.n += 1
                if query_side_effect.n % 2 == 1:
                    q.all.return_value = [admin_role, user_role]
                else:
                    q.all.return_value = [custom]
            return q

        db.query.side_effect = query_side_effect
        roles = RoleService.list_assignable_roles(db, org_id, caller_roles=[ORG_OWNER])
        assert any(r.key == ORG_ADMIN for r in roles)

        query_side_effect.n = 0

        def query_admin(model):
            q = _q()
            if not hasattr(query_admin, "n"):
                query_admin.n = 0
            query_admin.n += 1
            if query_admin.n % 2 == 1:
                q.all.return_value = [user_role]
            else:
                q.all.return_value = [custom]
            return q

        db.query.side_effect = query_admin
        roles_admin = RoleService.list_assignable_roles(db, org_id, caller_roles=[ORG_ADMIN])
        assert all(r.key != ORG_ADMIN or not r.is_system for r in roles_admin)
        assert any(r.key == USER for r in roles_admin)


def test_list_roles_for_management_and_permissions():
    db = MagicMock()
    org_id = uuid4()
    with patch("app.v1.roles.services.ensure_permission_catalog"):
        calls = {"n": 0}

        def query_side_effect(model):
            q = _q()
            calls["n"] += 1
            if calls["n"] == 1:
                q.all.return_value = [SimpleNamespace(key=ORG_OWNER, is_system=True)]
            elif calls["n"] == 2:
                q.all.return_value = [SimpleNamespace(key="c_1", is_system=False)]
            else:
                q.all.return_value = [("org.users.read",), ("org.users.write",)]
            return q

        db.query.side_effect = query_side_effect
        roles = RoleService.list_roles_for_management(db, org_id)
        assert len(roles) == 2
        keys = RoleService.get_role_permission_keys(db, SimpleNamespace(id=1))
        assert keys == ["org.users.read", "org.users.write"]


def test_assert_can_manage_custom_roles():
    user = MagicMock()
    user.has_role.return_value = False
    with pytest.raises(AuthorizationError):
        RoleService.assert_can_manage_custom_roles(user)

    user.has_role.return_value = True
    user.has_permission.return_value = False
    with pytest.raises(AuthorizationError):
        RoleService.assert_can_manage_custom_roles(user)

    user.has_permission.return_value = True
    RoleService.assert_can_manage_custom_roles(user)


def test_create_custom_role_validation_and_success():
    db = MagicMock()
    org_id = uuid4()
    with patch("app.v1.roles.services.ensure_permission_catalog"), patch.object(
        RoleService, "_set_role_permissions"
    ):
        with pytest.raises(ValidationError):
            RoleService.create_custom_role(db, org_id, "  ", ["org.users.read"])
        with pytest.raises(ValidationError):
            RoleService.create_custom_role(db, org_id, "x" * 101, ["org.users.read"])
        with pytest.raises(ValidationError, match="organization permissions"):
            RoleService.create_custom_role(db, org_id, "Support", ["platform.users.read"])

        db.query.return_value = _q(SimpleNamespace(id=1))
        with pytest.raises(ConflictError):
            RoleService.create_custom_role(db, org_id, "Support", ["org.users.read"])

        db.query.return_value = _q(None)
        with patch("app.v1.roles.services.Role", side_effect=lambda **kw: SimpleNamespace(**kw, id=9)):
            role = RoleService.create_custom_role(db, org_id, "Support", ["org.users.read"])
            assert role.label == "Support"
            assert role.is_system is False


def test_update_and_delete_custom_role():
    db = MagicMock()
    org_id = uuid4()
    role = SimpleNamespace(
        id=5, is_system=False, organization_id=org_id, label="Old", key="c_1"
    )
    state = {"n": 0}

    def update_query(_model):
        state["n"] += 1
        q = _q(role if state["n"] == 1 else None)
        return q

    db.query.side_effect = update_query
    with patch.object(RoleService, "_set_role_permissions"):
        updated = RoleService.update_custom_role(
            db, org_id, 5, label="New", permission_keys=["org.users.read"]
        )
        assert updated.label == "New"

    db.query.side_effect = None
    system = SimpleNamespace(id=1, is_system=True, organization_id=None)
    db.query.return_value = _q(system)
    with pytest.raises(AuthorizationError):
        RoleService.update_custom_role(db, org_id, 1, label="Nope")

    db.query.return_value = _q(None)
    with pytest.raises(NotFoundError):
        RoleService.update_custom_role(db, org_id, 99, label="X")

    role2 = SimpleNamespace(id=6, is_system=False, organization_id=org_id, label="Z")
    calls = {"n": 0}

    def side_effect(_model):
        calls["n"] += 1
        qq = _q(role2)
        # second query is assigned-user count
        qq.count.return_value = 2 if calls["n"] > 1 else 0
        return qq

    db.query.side_effect = side_effect
    with pytest.raises(BadRequestError):
        RoleService.delete_custom_role(db, org_id, 6)

    calls["n"] = 0

    def side_ok(_model):
        calls["n"] += 1
        qq = _q(role2)
        qq.count.return_value = 0
        return qq

    db.query.side_effect = side_ok
    db.delete = MagicMock()
    RoleService.delete_custom_role(db, org_id, 6)
    db.delete.assert_called()


def test_assert_assignable_role_keys_and_last_org_admin():
    db = MagicMock()
    org_id = uuid4()
    RoleService.assert_assignable_role_keys(db, org_id, None)
    RoleService.assert_assignable_role_keys(db, org_id, [])

    with pytest.raises(AuthorizationError):
        RoleService.assert_assignable_role_keys(db, org_id, ["super_admin"])

    user_role = SimpleNamespace(
        key=USER, is_system=True, organization_id=None, label="User"
    )
    db.query.return_value = _q(all_rows=[user_role])
    RoleService.assert_assignable_role_keys(db, org_id, [USER])

    db.query.return_value = _q(all_rows=[])
    with pytest.raises(ValidationError, match="Unknown"):
        RoleService.assert_assignable_role_keys(db, org_id, ["nope"])

    admin_role = SimpleNamespace(id=3, key=ORG_ADMIN)
    target = uuid4()
    actor = uuid4()
    state = {"n": 0}

    def last_admin_query(_model):
        q = _q()
        state["n"] += 1
        if state["n"] == 1:
            q.first.return_value = admin_role
        elif state["n"] == 2:
            q.first.return_value = SimpleNamespace()  # currently admin
        else:
            q.count.return_value = 0  # no other admins
        return q

    db.query.side_effect = last_admin_query
    with pytest.raises(ValidationError, match="last Organization Admin"):
        RoleService.assert_not_removing_last_org_admin(
            db, org_id, target, ["user"], actor
        )
