"""Organization role keys and shared org-scoped role sets.

Platform roles (e.g. super_admin) must not appear in org ACL tuples.
System roles are immutable; custom roles are org-scoped and editable.
"""

from __future__ import annotations

from typing import FrozenSet, Iterable, Set, Tuple


RoleTuple = Tuple[str, ...]

ORG_OWNER = "org_owner"
ORG_ADMIN = "org_admin"
USER = "user"
SUPER_ADMIN = "super_admin"

PLATFORM_ONLY_ROLES: FrozenSet[str] = frozenset({SUPER_ADMIN})

# Org-scoped but only super_admin may assign (never on org user routes).
PLATFORM_ASSIGNABLE_ORG_ROLES: FrozenSet[str] = frozenset({ORG_OWNER})

SYSTEM_ROLES: FrozenSet[str] = frozenset({SUPER_ADMIN, ORG_OWNER, ORG_ADMIN, USER})

# System roles shown on the org Roles & Permissions page (not platform).
ORG_VISIBLE_SYSTEM_ROLES: RoleTuple = (
    ORG_OWNER,
    ORG_ADMIN,
    USER,
)

# System roles org owners may assign on org user routes (not org_owner).
ORG_ASSIGNABLE_SYSTEM_ROLES: RoleTuple = (
    ORG_ADMIN,
    USER,
)

# System roles org admins may assign (cannot grant org_admin or org_owner).
ORG_ADMIN_ASSIGNABLE_SYSTEM_ROLES: RoleTuple = (USER,)

# Back-compat alias used across user services / bulk import.
ORG_ASSIGNABLE_ROLES: RoleTuple = ORG_ASSIGNABLE_SYSTEM_ROLES

MEDIA_MANAGER_ROLES: RoleTuple = (ORG_ADMIN,)


def assert_no_platform_roles_in_org_set(name: str, roles: Iterable[str]) -> None:
    """Guardrail for tests — org ACL tuples must not include platform roles."""
    forbidden = PLATFORM_ONLY_ROLES.intersection(roles)
    if forbidden:
        raise AssertionError(f"{name} must not include platform roles: {sorted(forbidden)}")


def effective_role_keys(stored_roles: Iterable[str]) -> Set[str]:
    """Expand stored keys for capability checks.

    `org_owner` satisfies every `org_admin` ACL without listing it on each allowlist.
    Assignment policy must use stored keys, not this set.
    """
    roles = set(stored_roles)
    if ORG_OWNER in roles:
        roles.add(ORG_ADMIN)
    return roles
