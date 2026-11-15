"""Canonical permission keys and default system-role grants.

Permissions are the authorization unit. Roles bundle permissions.
System role grants are re-synced from this module (DB must not drift).
"""

from __future__ import annotations

from typing import Dict, FrozenSet, List, Tuple

# -----------------------------------------------------------------------------
# Permission keys
# -----------------------------------------------------------------------------

PLATFORM_ORGANIZATIONS_READ = "platform.organizations.read"
PLATFORM_ORGANIZATIONS_WRITE = "platform.organizations.write"
PLATFORM_USERS_READ = "platform.users.read"
PLATFORM_USERS_WRITE = "platform.users.write"
PLATFORM_SETTINGS_MANAGE = "platform.settings.manage"

ORG_USERS_READ = "org.users.read"
ORG_USERS_WRITE = "org.users.write"
ORG_SETTINGS_MANAGE = "org.settings.manage"
ORG_CONFIGURATIONS_MANAGE = "org.configurations.manage"
ORG_MEDIA_MANAGE = "org.media.manage"
ORG_EMAIL_MANAGE = "org.email.manage"
ORG_NOTIFICATIONS_MANAGE = "org.notifications.manage"

PermissionDef = Tuple[str, str, str, str]  # key, label, description, scope

PERMISSION_CATALOG: Tuple[PermissionDef, ...] = (
    (
        PLATFORM_ORGANIZATIONS_READ,
        "View organizations",
        "List and view platform organizations",
        "platform",
    ),
    (
        PLATFORM_ORGANIZATIONS_WRITE,
        "Manage organizations",
        "Create, update, and delete platform organizations",
        "platform",
    ),
    (
        PLATFORM_USERS_READ,
        "View platform users",
        "List and view users across organizations",
        "platform",
    ),
    (
        PLATFORM_USERS_WRITE,
        "Manage platform users",
        "Create, update, and delete platform users",
        "platform",
    ),
    (
        PLATFORM_SETTINGS_MANAGE,
        "Manage platform settings",
        "Platform settings, cron jobs, API tools, and platform media",
        "platform",
    ),
    (
        ORG_USERS_READ,
        "View organization users",
        "List and view users in the organization",
        "org",
    ),
    (
        ORG_USERS_WRITE,
        "Manage organization users",
        "Create, update, delete users and assign roles",
        "org",
    ),
    (
        ORG_SETTINGS_MANAGE,
        "Manage site settings",
        "Organization site settings, branding, legal, and contact",
        "org",
    ),
    (
        ORG_CONFIGURATIONS_MANAGE,
        "Manage configurations",
        "Organization configuration such as profile completion",
        "org",
    ),
    (
        ORG_MEDIA_MANAGE,
        "Manage media",
        "Organization media manager",
        "org",
    ),
    (
        ORG_EMAIL_MANAGE,
        "Manage email",
        "Organization email templates and email engine",
        "org",
    ),
    (
        ORG_NOTIFICATIONS_MANAGE,
        "Manage notifications",
        "Organization notification settings and activity",
        "org",
    ),
)

ALL_PERMISSION_KEYS: FrozenSet[str] = frozenset(p[0] for p in PERMISSION_CATALOG)
PLATFORM_PERMISSION_KEYS: FrozenSet[str] = frozenset(
    p[0] for p in PERMISSION_CATALOG if p[3] == "platform"
)
ORG_PERMISSION_KEYS: FrozenSet[str] = frozenset(
    p[0] for p in PERMISSION_CATALOG if p[3] == "org"
)

# -----------------------------------------------------------------------------
# System role → permission grants (source of truth)
# -----------------------------------------------------------------------------

SYSTEM_ROLE_PERMISSIONS: Dict[str, FrozenSet[str]] = {
    "super_admin": PLATFORM_PERMISSION_KEYS,
    "org_owner": ORG_PERMISSION_KEYS,
    "org_admin": ORG_PERMISSION_KEYS,
    "user": frozenset(),
}

SYSTEM_ROLE_LABELS: Dict[str, str] = {
    "super_admin": "Super Admin",
    "org_owner": "Organization Owner",
    "org_admin": "Organization Admin",
    "user": "User",
}


def permission_keys_for_roles(role_keys: List[str]) -> List[str]:
    """Resolve catalog permissions for known system roles only (no DB)."""
    out: set[str] = set()
    for key in role_keys:
        out.update(SYSTEM_ROLE_PERMISSIONS.get(key, frozenset()))
    return sorted(out)
