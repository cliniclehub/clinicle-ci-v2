"""Custom org roles and permission catalog services."""

from __future__ import annotations

import uuid
from typing import Iterable, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.common.business_exceptions import (
    AuthorizationError,
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.v1.auth.org_roles import (
    ORG_ADMIN,
    ORG_ADMIN_ASSIGNABLE_SYSTEM_ROLES,
    ORG_ASSIGNABLE_SYSTEM_ROLES,
    ORG_OWNER,
    ORG_VISIBLE_SYSTEM_ROLES,
    PLATFORM_ONLY_ROLES,
)
from app.v1.auth.permissions import ORG_PERMISSION_KEYS
from app.v1.auth.schema import UserTokenInfo
from app.v1.roles.model import Permission, Role, RolePermission, UserRole
from app.v1.roles.permission_bootstrap import ensure_permission_catalog


def _slug_custom_key() -> str:
    return f"c_{uuid.uuid4().hex[:16]}"


class RoleService:
    @staticmethod
    def list_permissions(db: Session, scope: Optional[str] = None) -> List[Permission]:
        ensure_permission_catalog(db)
        q = db.query(Permission)
        if scope:
            q = q.filter(Permission.scope == scope)
        return q.order_by(Permission.key.asc()).all()

    @staticmethod
    def list_assignable_roles(
        db: Session,
        organization_id: UUID,
        caller_roles: Optional[Iterable[str]] = None,
    ) -> List[Role]:
        """System org-assignable roles + custom roles for this org.

        Org admins only receive ``user`` (+ custom). Org owners also receive ``org_admin``.
        """
        ensure_permission_catalog(db)
        stored = set(caller_roles or [])
        system_keys = (
            ORG_ASSIGNABLE_SYSTEM_ROLES
            if ORG_OWNER in stored
            else ORG_ADMIN_ASSIGNABLE_SYSTEM_ROLES
        )
        system = (
            db.query(Role)
            .filter(
                Role.is_system.is_(True),
                Role.key.in_(system_keys),
            )
            .order_by(Role.id.asc())
            .all()
        )
        custom = (
            db.query(Role)
            .filter(
                Role.is_system.is_(False),
                Role.organization_id == organization_id,
            )
            .order_by(Role.label.asc())
            .all()
        )
        return system + custom

    @staticmethod
    def list_roles_for_management(db: Session, organization_id: UUID) -> List[Role]:
        """Org-visible system roles (incl. org_owner) + custom roles for the Roles page."""
        ensure_permission_catalog(db)
        system = (
            db.query(Role)
            .filter(
                Role.is_system.is_(True),
                Role.key.in_(ORG_VISIBLE_SYSTEM_ROLES),
            )
            .order_by(Role.id.asc())
            .all()
        )
        custom = (
            db.query(Role)
            .filter(
                Role.is_system.is_(False),
                Role.organization_id == organization_id,
            )
            .order_by(Role.label.asc())
            .all()
        )
        return system + custom

    @staticmethod
    def get_role_permission_keys(db: Session, role: Role) -> List[str]:
        rows = (
            db.query(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .filter(RolePermission.role_id == role.id)
            .all()
        )
        return sorted({r[0] for r in rows})

    @staticmethod
    def assert_can_manage_custom_roles(current_user: UserTokenInfo) -> None:
        if not current_user.has_role(ORG_ADMIN):
            raise AuthorizationError("Only organization admins can manage custom roles")
        if not current_user.has_permission("org.users.write"):
            raise AuthorizationError("You are not authorized to manage roles")

    @staticmethod
    def create_custom_role(
        db: Session,
        organization_id: UUID,
        label: str,
        permission_keys: List[str],
    ) -> Role:
        label = (label or "").strip()
        if not label:
            raise ValidationError("Role label is required")
        if len(label) > 100:
            raise ValidationError("Role label is too long")

        unknown = set(permission_keys) - ORG_PERMISSION_KEYS
        if unknown:
            raise ValidationError(
                "Custom roles may only use organization permissions: "
                + ", ".join(sorted(unknown))
            )

        ensure_permission_catalog(db)
        existing = (
            db.query(Role)
            .filter(
                Role.organization_id == organization_id,
                Role.is_system.is_(False),
                Role.label == label,
            )
            .first()
        )
        if existing:
            raise ConflictError("A custom role with this label already exists")

        role = Role(
            key=_slug_custom_key(),
            label=label,
            is_system=False,
            organization_id=organization_id,
        )
        db.add(role)
        db.flush()
        RoleService._set_role_permissions(db, role, permission_keys)
        return role

    @staticmethod
    def update_custom_role(
        db: Session,
        organization_id: UUID,
        role_id: int,
        label: Optional[str] = None,
        permission_keys: Optional[List[str]] = None,
    ) -> Role:
        role = db.query(Role).filter(Role.id == role_id).first()
        if not role:
            raise NotFoundError("Custom role not found")
        if role.is_system:
            raise AuthorizationError("System roles cannot be modified")
        if role.organization_id != organization_id:
            raise NotFoundError("Custom role not found")

        if label is not None:
            label = label.strip()
            if not label:
                raise ValidationError("Role label is required")
            clash = (
                db.query(Role)
                .filter(
                    Role.organization_id == organization_id,
                    Role.is_system.is_(False),
                    Role.label == label,
                    Role.id != role_id,
                )
                .first()
            )
            if clash:
                raise ConflictError("A custom role with this label already exists")
            role.label = label

        if permission_keys is not None:
            unknown = set(permission_keys) - ORG_PERMISSION_KEYS
            if unknown:
                raise ValidationError(
                    "Custom roles may only use organization permissions: "
                    + ", ".join(sorted(unknown))
                )
            RoleService._set_role_permissions(db, role, permission_keys)

        db.flush()
        return role

    @staticmethod
    def delete_custom_role(db: Session, organization_id: UUID, role_id: int) -> None:
        role = db.query(Role).filter(Role.id == role_id).first()
        if not role:
            raise NotFoundError("Custom role not found")
        if role.is_system:
            raise AuthorizationError("System roles cannot be deleted")
        if role.organization_id != organization_id:
            raise NotFoundError("Custom role not found")

        assigned = (
            db.query(UserRole)
            .filter(
                UserRole.role_id == role.id,
                UserRole.organization_id == organization_id,
            )
            .count()
        )
        if assigned:
            raise BadRequestError(
                "Cannot delete a custom role while it is assigned to users"
            )
        db.delete(role)
        db.flush()

    @staticmethod
    def _set_role_permissions(db: Session, role: Role, permission_keys: List[str]) -> None:
        if role.is_system:
            raise AuthorizationError("System role permissions cannot be changed")
        desired = set(permission_keys)
        perms = {
            p.key: p
            for p in db.query(Permission).filter(Permission.key.in_(desired)).all()
        }
        desired_ids = {perms[k].id for k in desired if k in perms}
        existing = db.query(RolePermission).filter(RolePermission.role_id == role.id).all()
        existing_ids = {rp.permission_id for rp in existing}
        for rp in existing:
            if rp.permission_id not in desired_ids:
                db.delete(rp)
        for pid in desired_ids - existing_ids:
            db.add(RolePermission(role_id=role.id, permission_id=pid))
        db.flush()

    @staticmethod
    def assert_assignable_role_keys(
        db: Session,
        organization_id: UUID,
        role_keys: Optional[List[str]],
    ) -> None:
        """Allow system org-assignable keys or custom roles owned by the org."""
        if not role_keys:
            return
        forbidden = PLATFORM_ONLY_ROLES.intersection(role_keys)
        if forbidden:
            raise AuthorizationError("Organization admins cannot assign platform roles")

        unique_keys = list(dict.fromkeys(role_keys))
        roles = db.query(Role).filter(Role.key.in_(unique_keys)).all()
        by_key = {r.key: r for r in roles}
        missing = [k for k in unique_keys if k not in by_key]
        if missing:
            raise ValidationError("Unknown role(s): " + ", ".join(missing))

        for key in unique_keys:
            role = by_key[key]
            if role.is_system:
                if role.key not in ORG_ASSIGNABLE_SYSTEM_ROLES:
                    raise AuthorizationError(
                        f"Role '{role.key}' cannot be assigned by organization admins"
                    )
            else:
                if role.organization_id != organization_id:
                    raise AuthorizationError(
                        f"Custom role '{role.label}' does not belong to this organization"
                    )

    @staticmethod
    def assert_not_removing_last_org_admin(
        db: Session,
        organization_id: UUID,
        target_user_id: UUID,
        new_role_keys: List[str],
        actor_user_id: UUID,
    ) -> None:
        """Block removing org_admin from the last org admin (including self)."""
        org_admin_role = db.query(Role).filter(Role.key == ORG_ADMIN).first()
        if not org_admin_role:
            return

        currently_admin = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == target_user_id,
                UserRole.organization_id == organization_id,
                UserRole.role_id == org_admin_role.id,
            )
            .first()
            is not None
        )
        will_be_admin = ORG_ADMIN in (new_role_keys or [])
        if not currently_admin or will_be_admin:
            return

        other_admins = (
            db.query(UserRole)
            .filter(
                UserRole.organization_id == organization_id,
                UserRole.role_id == org_admin_role.id,
                UserRole.user_id != target_user_id,
            )
            .count()
        )
        if other_admins == 0:
            raise ValidationError(
                "Cannot remove the last Organization Admin from this organization"
            )
