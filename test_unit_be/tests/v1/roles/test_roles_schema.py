"""Smoke tests for the retained permission-based roles contract."""

from app.v1.roles.model import Role as RoleModel, UserRole
from app.v1.roles.schema import CustomRoleCreate, CustomRoleUpdate, PermissionOut, RoleOut


def test_role_schema_importable():
    assert RoleOut is not None
    assert PermissionOut is not None
    assert CustomRoleCreate is not None
    assert CustomRoleUpdate is not None


def test_role_model_importable():
    assert RoleModel is not None
    assert UserRole is not None


def test_role_create_schema_has_required_fields():
    role = CustomRoleCreate(label="Support", permissions=["org.users.read"])
    assert role.label == "Support"
    assert role.permissions == ["org.users.read"]


def test_role_update_schema_all_optional():
    role = CustomRoleUpdate()
    assert role.label is None
    assert role.permissions is None
