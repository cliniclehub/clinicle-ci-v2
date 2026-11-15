"""Which roles org staff may assign on organization user routes."""

from __future__ import annotations

from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.common.business_exceptions import AuthorizationError
from app.v1.auth.org_roles import (
    ORG_ADMIN,
    ORG_OWNER,
    PLATFORM_ASSIGNABLE_ORG_ROLES,
    PLATFORM_ONLY_ROLES,
)
from app.v1.roles.services import RoleService


def assert_org_assignable_roles(
    roles: Optional[Iterable[str]],
    *,
    db: Session,
    organization_id: UUID,
) -> None:
    """Reject platform-only / platform-assignable org roles; allow org system + custom."""
    if roles:
        requested = set(roles)
        if PLATFORM_ONLY_ROLES.intersection(requested):
            raise AuthorizationError("Organization admins cannot assign platform roles")
        if PLATFORM_ASSIGNABLE_ORG_ROLES.intersection(requested):
            raise AuthorizationError(
                "Organization Owner can only be assigned by a platform administrator"
            )
    RoleService.assert_assignable_role_keys(
        db,
        organization_id,
        list(roles) if roles else None,
    )


def assert_org_cannot_manage_org_owner(existing_roles: Optional[Iterable[str]]) -> None:
    """Org routes cannot mutate a user who currently holds org_owner."""
    if existing_roles and ORG_OWNER in existing_roles:
        raise AuthorizationError(
            "Organization Owner accounts can only be managed from platform administration"
        )


def assert_caller_may_assign_roles(
    caller_roles: Iterable[str],
    requested_roles: Optional[Iterable[str]],
    existing_roles: Optional[Iterable[str]] = None,
) -> None:
    """Org-route assignment using stored keys, not implied org_admin.

    - Never add or remove org_owner / super_admin via org routes.
    - Assigning or editing org_admin requires a stored org_owner caller.
    """
    requested = set(requested_roles or [])
    existing = set(existing_roles or [])
    caller = set(caller_roles or [])

    assert_org_cannot_manage_org_owner(existing)

    if ORG_ADMIN in requested or ORG_ADMIN in existing:
        if ORG_OWNER not in caller:
            raise AuthorizationError(
                "Only Organization Owners can assign the organization admin role"
            )
