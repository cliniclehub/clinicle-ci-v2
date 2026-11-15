from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.api_response_schema import SuccessMessages, success_response
from app.common.auth_helper import get_current_user
from app.common.database_pool import get_db
from app.v1.auth.permissions import ORG_USERS_WRITE
from app.v1.auth.schema import UserTokenInfo
from app.v1.roles.schema import CustomRoleCreate, CustomRoleUpdate, PermissionOut, RoleOut
from app.v1.roles.services import RoleService

router = APIRouter(prefix="/roles", tags=["Roles"])


def _role_out(db: Session, role) -> RoleOut:
    return RoleOut(
        id=role.id,
        key=role.key,
        label=role.label,
        is_system=bool(role.is_system),
        organization_id=role.organization_id,
        permissions=RoleService.get_role_permission_keys(db, role),
        created_at=role.created_at,
        updated_at=role.updated_at,
    )


@router.get("/permissions", response_model=None)
async def list_permissions(
    scope: Optional[str] = Query(None, description="platform | org"),
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    RoleService.assert_can_manage_custom_roles(current_user)
    # Org admins only need org scope for custom roles; still allow listing org scope.
    effective_scope = scope or "org"
    if effective_scope == "platform" and not current_user.has_role("super_admin"):
        from app.common.business_exceptions import AuthorizationError

        raise AuthorizationError("Only platform administrators can list platform permissions")
    items = RoleService.list_permissions(db, scope=effective_scope)
    return success_response(
        data=[PermissionOut.model_validate(p) for p in items],
        message=SuccessMessages.RETRIEVED,
    )


@router.get("/assignable", response_model=None)
async def list_assignable_roles(
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    if not current_user.has_permission(ORG_USERS_WRITE) and not current_user.has_role(
        "org_admin"
    ):
        from app.common.business_exceptions import AuthorizationError

        raise AuthorizationError("You are not authorized to list assignable roles")
    roles = RoleService.list_assignable_roles(
        db, current_user.organization_id, caller_roles=current_user.roles
    )
    return success_response(
        data=[_role_out(db, r) for r in roles],
        message=SuccessMessages.RETRIEVED,
    )


@router.get("/manage", response_model=None)
async def list_roles_for_management(
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """Roles page: org_owner / org_admin / user + custom roles (view system, edit custom)."""
    RoleService.assert_can_manage_custom_roles(current_user)
    roles = RoleService.list_roles_for_management(db, current_user.organization_id)
    return success_response(
        data=[_role_out(db, r) for r in roles],
        message=SuccessMessages.RETRIEVED,
    )


@router.post("/custom", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_custom_role(
    payload: CustomRoleCreate,
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    RoleService.assert_can_manage_custom_roles(current_user)
    role = RoleService.create_custom_role(
        db,
        current_user.organization_id,
        payload.label,
        payload.permissions,
    )
    db.commit()
    db.refresh(role)
    return success_response(data=_role_out(db, role), message=SuccessMessages.CREATED)


@router.patch("/custom/{role_id}", response_model=None)
async def update_custom_role(
    role_id: int,
    payload: CustomRoleUpdate,
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    RoleService.assert_can_manage_custom_roles(current_user)
    role = RoleService.update_custom_role(
        db,
        current_user.organization_id,
        role_id,
        label=payload.label,
        permission_keys=payload.permissions,
    )
    db.commit()
    db.refresh(role)
    return success_response(data=_role_out(db, role), message=SuccessMessages.UPDATED)


@router.delete("/custom/{role_id}", response_model=None)
async def delete_custom_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    RoleService.assert_can_manage_custom_roles(current_user)
    RoleService.delete_custom_role(db, current_user.organization_id, role_id)
    db.commit()
    return success_response(data={"deleted": True}, message=SuccessMessages.DELETED)
