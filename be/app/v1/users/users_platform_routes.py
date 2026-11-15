from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session
from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages, paginated_response
from app.common.auth_helper import assert_permission, get_current_user, UserTokenInfo
from app.v1.auth.permissions import PLATFORM_USERS_READ, PLATFORM_USERS_WRITE
from app.v1.users.schema import User, UserCreate, UserUpdate
from app.v1.users.services import UserService
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
@router.get("/platform")
async def get_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search term for email, first_name, or last_name"),
    sort_by: str = Query(default="created_at", description="Field to sort by"),
    sort_order: str = Query(default="desc", description="Sort order (asc or desc)"),
    filters: Optional[str] = Query(None, description="Advanced filters as JSON string"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, PLATFORM_USERS_READ)

    
    # Calculate skip from page and page_size
    skip = (page - 1) * page_size
    
    users, total = await UserService.get_users(
        db, skip, page_size, search, sort_by, sort_order, None, filters
    )
    
    return paginated_response(
        data=users,
        total=total,
        page=page,
        limit=page_size,
        message=SuccessMessages.LISTED
    )

#--------------------------------
# Create User
#--------------------------------
@router.post("/platform")
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: UserTokenInfo = Depends(get_current_user)
):
    # Check permissions
    assert_permission(current_user, PLATFORM_USERS_WRITE)
    
    
    user = await UserService.create_user(
        db=db, 
        user_data=user_data, 
    )
    
    return success_response(
        data=user,
        message=SuccessMessages.CREATED
    )


#--------------------------------
# Get User by ID
#--------------------------------
@router.get("/platform/{user_id}")
async def get_user(
    user_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, PLATFORM_USERS_READ)
    
    user_data = await UserService.get_user(db, user_id, None)
    return success_response(data=user_data, message=SuccessMessages.RETRIEVED)

#--------------------------------
# Update User
#--------------------------------
@router.put("/platform/{user_id}")
async def update_user(
    user_id: UUID,
    user_data: UserUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, PLATFORM_USERS_WRITE)

    #check if the supplied org id is diff from the  user's existing  organization_id
    user = await UserService.get_user(db, user_id, None)
    if user_data.organization_id is not None and user.organization_id != user_data.organization_id:
        raise ValidationError("You cannot change the organization of this user")
    
    updated_user = await UserService.update_user(db, user_id, user_data)
    return success_response(data=updated_user, message=SuccessMessages.UPDATED)

#--------------------------------
# Delete User
#--------------------------------
@router.delete("/platform/{user_id}", )
async def delete_user(
    user_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Check authorization
    assert_permission(current_user, PLATFORM_USERS_WRITE)
    
    await UserService.delete_user(db, user_id, None)
    return success_response(message=SuccessMessages.DELETED)


#--------------------------------
# Admin Change User Password
#--------------------------------
@router.post("/platform/{user_id}/change-password", )
async def admin_change_user_password(
    user_id: UUID,
    password_data: dict = Body(..., example={"newPassword": "newpass123"}),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Admin endpoint to change user password without old password verification"""
    # Check authorization
    assert_permission(current_user, PLATFORM_USERS_WRITE)
    
    new_password = password_data.get("newPassword")
    if not new_password:
        raise ValidationError("newPassword is required")
    
    # Prevent users from changing their own password through this endpoint
    if str(user_id) == str(current_user.id):
        raise ValidationError("Use /users/me/change-password to change your own password")
    
    # Change password
    await UserService.admin_change_user_password(db, user_id, new_password, None)
    
    logger.info(f"Admin {current_user.id} changed password for user {user_id}")
    return success_response(message="Password changed successfully")

#--------------------------------
