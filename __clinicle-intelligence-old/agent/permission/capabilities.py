"""Capability registry for the org RBAC-plus permission system (Settings > Permissions).

Distinct from ``agent/permission/policy.py``, which confines what tools an
Agent *session* may execute (read-only / workspace-write / full-access) --
an unrelated axis with unrelated persistence, scoped to one agent run, not
one org member. This module is about which *product areas* a member of an
org may see or act on, enforced via ``TenancyStore.has_capability()``.

Capabilities are a deploy-time concept (the list of gate-able areas is a
property of this codebase's routes/views, not of any one tenant's data), so
they live here as a static registry rather than in the database. What IS
tenant data is which roles have which capability -- that's the
``role_capabilities`` table in ``agent/tenancy/store.py``, seeded from
DEFAULT_ROLE_CAPABILITIES below and overridable per org via the Settings >
Permissions matrix.
"""

from __future__ import annotations

# (group, key, label) -- key is what handlers/UI check against; label is
# what the Settings > Permissions matrix displays. Group just clusters rows
# in that matrix (product areas vs. settings sections).
CAPABILITIES: list[tuple[str, str, str]] = [
    ("Product", "chat", "Chat"),
    ("Product", "agents", "Agents"),
    ("Product", "workflows", "Workflows"),
    ("Product", "knowledge", "Knowledge Base"),
    ("Product", "analytics", "Analytics"),
    ("Settings", "settings.general", "General settings"),
    ("Settings", "settings.security", "Security & Access"),
    ("Settings", "settings.billing", "Billing"),
    ("Settings", "settings.users", "Users"),
    ("Settings", "settings.permissions", "Permissions"),
    ("Settings", "settings.connectors", "Connectors"),
    ("Settings", "settings.channels", "Channels"),
    ("Settings", "settings.sovereignty", "Sovereignty"),
]

CAPABILITY_KEYS: frozenset[str] = frozenset(key for _, key, _ in CAPABILITIES)

# Seed defaults for an org with no explicit role_capabilities override yet.
# Owner always has every capability regardless of this table (see
# TenancyStore.has_capability) -- these defaults exist for admin/member only,
# and are editable per org from the Permissions matrix from there on.
DEFAULT_ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    "admin": frozenset(CAPABILITY_KEYS),
    "member": frozenset({"chat", "agents", "workflows", "knowledge"}),
}


def is_known_capability(key: str) -> bool:
    return key in CAPABILITY_KEYS
