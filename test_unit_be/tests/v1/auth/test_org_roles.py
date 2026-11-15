"""Tests for shared organization role constants."""

from app.v1.auth import org_roles as roles


def test_org_acl_sets_exclude_platform_roles():
    for name, value in vars(roles).items():
        if not name.endswith("_ROLES"):
            continue
        if isinstance(value, tuple):
            roles.assert_no_platform_roles_in_org_set(name, value)


def test_platform_only_roles_contains_super_admin():
    assert roles.SUPER_ADMIN in roles.PLATFORM_ONLY_ROLES


def test_org_assignable_roles_excludes_super_admin():
    roles.assert_no_platform_roles_in_org_set(
        "ORG_ASSIGNABLE_ROLES", roles.ORG_ASSIGNABLE_ROLES
    )
    assert roles.SUPER_ADMIN not in roles.ORG_ASSIGNABLE_ROLES


def test_org_admin_assignable_excludes_org_admin():
    assert roles.ORG_ADMIN not in roles.ORG_ADMIN_ASSIGNABLE_SYSTEM_ROLES
    assert roles.USER in roles.ORG_ADMIN_ASSIGNABLE_SYSTEM_ROLES
    assert roles.ORG_ADMIN in roles.ORG_ASSIGNABLE_SYSTEM_ROLES
