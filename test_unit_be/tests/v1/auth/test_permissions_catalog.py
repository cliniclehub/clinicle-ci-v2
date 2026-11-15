"""Permission catalog and system role grant resolution."""

from app.v1.auth.permissions import (
    ORG_PERMISSION_KEYS,
    PLATFORM_PERMISSION_KEYS,
    SYSTEM_ROLE_PERMISSIONS,
    permission_keys_for_roles,
)


def test_system_role_grants():
    assert SYSTEM_ROLE_PERMISSIONS["super_admin"] == PLATFORM_PERMISSION_KEYS
    assert SYSTEM_ROLE_PERMISSIONS["org_admin"] == ORG_PERMISSION_KEYS
    assert SYSTEM_ROLE_PERMISSIONS["user"] == frozenset()


def test_permission_keys_for_roles_union():
    keys = permission_keys_for_roles(["org_admin", "user"])
    assert "org.users.read" in keys
    assert "platform.users.read" not in keys
