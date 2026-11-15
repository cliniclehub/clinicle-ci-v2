"""Ensure permission catalog and immutable system role grants exist in DB."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.v1.auth.org_roles import SYSTEM_ROLES
from app.v1.auth.permissions import (
    PERMISSION_CATALOG,
    SYSTEM_ROLE_LABELS,
    SYSTEM_ROLE_PERMISSIONS,
)
from app.v1.roles.model import Permission, Role, RolePermission


def ensure_permission_catalog(db: Session) -> None:
    """Upsert catalog permissions and sync immutable system role grants."""
    for key, label, description, scope in PERMISSION_CATALOG:
        perm = db.query(Permission).filter(Permission.key == key).first()
        if not perm:
            db.add(
                Permission(
                    key=key,
                    label=label,
                    description=description,
                    scope=scope,
                )
            )
        else:
            perm.label = label
            perm.description = description
            perm.scope = scope
    db.flush()

    for role_key in SYSTEM_ROLES:
        role = db.query(Role).filter(Role.key == role_key).first()
        if not role:
            role = Role(
                key=role_key,
                label=SYSTEM_ROLE_LABELS[role_key],
                is_system=True,
                organization_id=None,
            )
            db.add(role)
            db.flush()
        else:
            role.label = SYSTEM_ROLE_LABELS[role_key]
            role.is_system = True
            role.organization_id = None

    db.flush()

    perm_by_key = {p.key: p for p in db.query(Permission).all()}
    for role_key, grant_keys in SYSTEM_ROLE_PERMISSIONS.items():
        role = db.query(Role).filter(Role.key == role_key).first()
        if not role:
            continue
        desired_ids = {perm_by_key[k].id for k in grant_keys if k in perm_by_key}
        existing = (
            db.query(RolePermission).filter(RolePermission.role_id == role.id).all()
        )
        existing_ids = {rp.permission_id for rp in existing}
        for rp in existing:
            if rp.permission_id not in desired_ids:
                db.delete(rp)
        for pid in desired_ids - existing_ids:
            db.add(RolePermission(role_id=role.id, permission_id=pid))

    db.flush()


def resolve_permission_keys_for_user_roles(db: Session, roles: list[Role]) -> list[str]:
    """Union of permission keys granted by the given Role rows."""
    if not roles:
        return []
    role_ids = [r.id for r in roles]
    rows = (
        db.query(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id.in_(role_ids))
        .distinct()
        .all()
    )
    return sorted({row[0] for row in rows})
