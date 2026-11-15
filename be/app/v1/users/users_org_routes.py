from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session
from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages, paginated_response
from app.common.auth_helper import assert_any_permission, assert_permission, get_current_user, UserTokenInfo
from app.v1.auth.permissions import ORG_USERS_READ, ORG_USERS_WRITE
from app.v1.users.schema import User, UserCreate, UserUpdate, BulkUserCreateRequest, BulkUserCreateResponse
from app.v1.users.services import UserService
from app.v1.roles.services import RoleService
from app.common.app_logger import get_logger
from app.common.business_exceptions import AuthorizationError, ValidationError

logger = get_logger(__name__)

router = APIRouter(
    prefix="/users",
    tags=["users"]
)



#********************************************************************************
# CRUD Operations - Super Admin
#********************************************************************************

#--------------------------------
# Get Users (with optional org filtering)
#--------------------------------
@router.get("/org")
async def get_users(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search term for email, first_name, or last_name"),
    sortBy: str = Query(default="created_at", description="Field to sort by"),
    sortOrder: str = Query(default="desc", description="Sort order (asc or desc)"),
    isLocked: Optional[bool] = Query(None, description="Filter by locked status"),
    role: Optional[str] = Query(None, description="Filter by role"),
    filters: Optional[str] = Query(None, description="Advanced filters as JSON string"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, ORG_USERS_READ)
    
    # Debug logging
    logger.debug(f"Received parameters: page={page}, pageSize={pageSize}, search={search}, sortBy={sortBy}, sortOrder={sortOrder}")
    
    # Calculate skip from page and pageSize
    skip = (page - 1) * pageSize
    
    users, total = await UserService.get_users(
        db, skip, pageSize, search, sortBy, sortOrder, current_user.organization_id, filters
    )
    
    return paginated_response(
        data=users,
        total=total,
        page=page,
        limit=pageSize,
        message=SuccessMessages.LISTED
    )



#--------------------------------
# Get User by ID
#--------------------------------
@router.get("/org/{user_id}")
async def get_user(
    user_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, ORG_USERS_READ)
    
    user_data = await UserService.get_user(db, user_id, current_user.organization_id)
    return success_response(data=user_data, message=SuccessMessages.RETRIEVED)



#--------------------------------
# Create User
#--------------------------------
@router.post("/org")
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user)
):

    # Check permissions
    assert_permission(current_user, ORG_USERS_WRITE)
    
    # Check if the organization_id is the same as the current user's organization_id
    if user_data.organization_id != current_user.organization_id:
        raise AuthorizationError("You are not authorized to create users in this organization")
    
    if not user_data.roles:
        user_data = user_data.model_copy(update={"roles": ["user"]})

    from app.v1.users.org_role_policy import (
        assert_caller_may_assign_roles,
        assert_org_assignable_roles,
    )

    assert_org_assignable_roles(user_data.roles, db=db, organization_id=current_user.organization_id)
    assert_caller_may_assign_roles(current_user.roles, user_data.roles)
    
    user_data.organization_id = current_user.organization_id
    
    user = await UserService.create_user(
        db=db, 
        user_data=user_data, 
    )
    
    return success_response(
        data=user,
        message=SuccessMessages.CREATED
    )


#--------------------------------
# Bulk Create Users
#--------------------------------
@router.post("/org/bulk")
async def bulk_create_users(
    data: BulkUserCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user)
):
    """Create multiple users in bulk from CSV/Excel import"""
    # Check permissions
    assert_permission(current_user, ORG_USERS_WRITE)
    
    org_id = current_user.organization_id
    if not org_id:
        raise AuthorizationError("Organization not found in token")
    
    from app.v1.users.org_role_policy import (
        assert_caller_may_assign_roles,
        assert_org_assignable_roles,
    )

    # Convert request data to format expected by service
    # Note: CamelModel automatically converts camelCase to snake_case
    users_data = []
    for user_item in data.users:
        roles = user_item.roles if "roles" in user_item.model_fields_set else None
        if roles is not None:
            assert_org_assignable_roles(
                roles, db=db, organization_id=org_id
            )
            assert_caller_may_assign_roles(current_user.roles, roles)
        users_data.append({
            "email": user_item.email,
            "firstName": user_item.first_name,  # first_name from schema (CamelModel converts firstName -> first_name)
            "lastName": user_item.last_name,    # last_name from schema (CamelModel converts lastName -> last_name)
            "password": user_item.password,
            "phoneNumber": user_item.phone_number,
            "roles": user_item.roles,
            "rolesFieldInRequest": "roles" in user_item.model_fields_set,
        })
    
    result = await UserService.bulk_create_users(
        db=db,
        org_id=org_id,
        users_data=users_data,
        created_by_user_id=current_user.id,
        skip_email_verification=True  # Skip email verification for bulk imports
    )
    
    return success_response(
        data=BulkUserCreateResponse(**result),
        message=f"Bulk user creation completed: {result['success_count']} succeeded, {result['error_count']} failed"
    )


#--------------------------------
# Update User
#--------------------------------
@router.put("/org/{user_id}")
async def update_user(
    user_id: UUID,
    user_data: UserUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, ORG_USERS_WRITE)
    
    # SECURITY: Prevent users from updating their own roles even through this endpoint
    if str(user_id) == str(current_user.id):
        if user_data.roles is not None:
            logger.warning(f"User {current_user.id} attempted to update their own roles via /{user_id}. Request denied.")
            raise ValidationError("You cannot update your own roles")
    

    #SECURITY: check if the supplied org id is diff from the  user's existing  organization_id
    user = await UserService.get_user(db, user_id, None)
    if user_data.organization_id is not None and user.organization_id != user_data.organization_id:
        raise ValidationError("You are not authorized to update this user's organization")
    
    #SECURITY: check if the user is in the current user's organization
    user = await UserService.get_user(db, user_id, current_user.organization_id)
    if not user:
        raise AuthorizationError("You are not authorized to update this user")

    from app.v1.users.org_role_policy import (
        assert_caller_may_assign_roles,
        assert_org_assignable_roles,
        assert_org_cannot_manage_org_owner,
    )

    # Org Owner accounts are platform-managed only (any field, not just roles).
    assert_org_cannot_manage_org_owner(user.roles)

    if user_data.roles is not None:
        assert_permission(current_user, ORG_USERS_WRITE)
        assert_org_assignable_roles(user_data.roles, db=db, organization_id=current_user.organization_id)
        assert_caller_may_assign_roles(current_user.roles, user_data.roles, user.roles)
        RoleService.assert_not_removing_last_org_admin(
            db,
            current_user.organization_id,
            user_id,
            user_data.roles,
            current_user.id,
        )

    updated_user = await UserService.update_user(db, user_id, user_data)
    return success_response(data=updated_user, message=SuccessMessages.UPDATED)

#--------------------------------
# Delete User
#--------------------------------
@router.delete("/org/{user_id}", )
async def delete_user(
    user_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, ORG_USERS_WRITE)
    
    #check if the user is in the current user's organization
    user = await UserService.get_user(db, user_id, current_user.organization_id)
    if not user:
        raise AuthorizationError("You are trying to delete a user that is not in your organization")

    from app.v1.users.org_role_policy import assert_org_cannot_manage_org_owner

    assert_org_cannot_manage_org_owner(user.roles)
    
    await UserService.delete_user(db, user_id, current_user.organization_id)
    return success_response(message=SuccessMessages.DELETED)


#--------------------------------
# Admin Change User Password
#--------------------------------
@router.post("/org/{user_id}/change-password", )
async def admin_change_user_password(
    user_id: UUID,
    password_data: dict = Body(..., example={"newPassword": "newpass123"}),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Admin endpoint to change user password without old password verification"""
    # Check authorization
    assert_permission(current_user, ORG_USERS_WRITE)
    
    #check if the user is in the current user's organization
    user = await UserService.get_user(db, user_id, current_user.organization_id)
    if not user:
        raise AuthorizationError("You are trying to change the password of a user that is not in your organization")

    from app.v1.users.org_role_policy import assert_org_cannot_manage_org_owner

    assert_org_cannot_manage_org_owner(user.roles)
    
    new_password = password_data.get("newPassword")
    if not new_password:
        raise ValidationError("newPassword is required")
    
    # Prevent users from changing their own password through this endpoint
    if str(user_id) == str(current_user.id):
        raise ValidationError("Use /users/me/change-password to change your own password")
    
    # Change password
    await UserService.admin_change_user_password(db, user_id, new_password, current_user.organization_id)
    
    logger.info(f"Admin {current_user.id} changed password for user {user_id}")
    return success_response(message="Password changed successfully")

#--------------------------------
# Get User Statistics
#--------------------------------
@router.get("/statistics")
async def get_user_statistics(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user statistics for the organization"""
    # Check authorization
    assert_permission(current_user, ORG_USERS_READ)
    
    statistics = await UserService.get_user_statistics(db, current_user.organization_id)
    return success_response(data=statistics, message=SuccessMessages.RETRIEVED)



