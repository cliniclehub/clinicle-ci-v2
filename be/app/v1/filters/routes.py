from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import assert_any_permission, get_current_user, UserTokenInfo
from app.v1.auth.permissions import ORG_USERS_READ, PLATFORM_USERS_READ
from app.v1.filters.schema import (
    SavedFilterCreate, 
    SavedFilterUpdate, 
    SavedFilterResponse
)
from app.v1.filters.services import SavedFilterService
from app.common.business_exceptions import BadRequestError, NotFoundError, AuthorizationError
from app.common.app_logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/filters", tags=["Saved Filters"])


#********************************************************************************
# Create Saved Filter
#********************************************************************************
@router.post("/")
async def create_saved_filter(
    filter_data: SavedFilterCreate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new saved filter"""
    assert_any_permission(current_user, ORG_USERS_READ, PLATFORM_USERS_READ)
    
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    methodLogger = logger.get_method_logger('create_saved_filter')
    methodLogger.info('Creating saved filter', extra={
        'user_id': str(current_user.id),
        'organization_id': str(org_id),
        'page_type': filter_data.page_type,
        'filter_name': filter_data.name
    })
    
    saved_filter = await SavedFilterService.create_saved_filter(
        db, current_user.id, org_id, filter_data
    )
    return success_response(data=saved_filter, message=SuccessMessages.CREATED)


#********************************************************************************
# Get Saved Filters
#********************************************************************************
@router.get("/")
async def get_saved_filters(
    page_type: Optional[str] = Query(None, description="Filter by page type"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's saved filters, optionally filtered by page type"""
    assert_any_permission(current_user, ORG_USERS_READ, PLATFORM_USERS_READ)
    
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    methodLogger = logger.get_method_logger('get_saved_filters')
    methodLogger.info('Getting saved filters', extra={
        'user_id': str(current_user.id),
        'organization_id': str(org_id),
        'page_type': page_type
    })
    
    saved_filters = await SavedFilterService.get_user_saved_filters(
        db, current_user.id, org_id, page_type
    )
    return success_response(data=saved_filters, message=SuccessMessages.LISTED)


#********************************************************************************
# Get Saved Filter by ID
#********************************************************************************
@router.get("/{filter_id}")
async def get_saved_filter_by_id(
    filter_id: int,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    assert_any_permission(current_user, ORG_USERS_READ, PLATFORM_USERS_READ)
    
    """Get a specific saved filter by ID"""
    methodLogger = logger.get_method_logger('get_saved_filter_by_id')
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    methodLogger.info('Getting saved filter by ID', extra={
        'filter_id': str(filter_id),
        'user_id': str(current_user.id),
        'organization_id': str(org_id)
    })
    
    saved_filter = await SavedFilterService.get_saved_filter_by_id(
        db, filter_id, current_user.id, org_id
    )
    return success_response(data=saved_filter, message=SuccessMessages.RETRIEVED)


#********************************************************************************
# Update Saved Filter
#********************************************************************************
@router.put("/{filter_id}")
async def update_saved_filter(
    filter_id: int,
    filter_data: SavedFilterUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an existing saved filter"""
    methodLogger = logger.get_method_logger('update_saved_filter')
    assert_any_permission(current_user, ORG_USERS_READ, PLATFORM_USERS_READ)
    
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    methodLogger.info('Updating saved filter', extra={
        'filter_id': str(filter_id),
        'user_id': str(current_user.id),
        'organization_id': str(org_id)
    })
    
    saved_filter = await SavedFilterService.update_saved_filter(
        db, filter_id, current_user.id, org_id, filter_data
    )
    return success_response(data=saved_filter, message=SuccessMessages.UPDATED)


#********************************************************************************
# Delete Saved Filter
#********************************************************************************
@router.delete("/{filter_id}")
async def delete_saved_filter(
    filter_id: int,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a saved filter"""
    methodLogger = logger.get_method_logger('delete_saved_filter')
    assert_any_permission(current_user, ORG_USERS_READ, PLATFORM_USERS_READ)
    
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    methodLogger.info('Deleting saved filter', extra={
        'filter_id': str(filter_id),
        'user_id': str(current_user.id),
        'organization_id': str(org_id)
    })
    
    await SavedFilterService.delete_saved_filter(db, filter_id, current_user.id, org_id)
    return success_response(data=None, message=SuccessMessages.DELETED)


#********************************************************************************
# Get Default Filter
#********************************************************************************
@router.get("/default/{page_type}")
async def get_default_filter(
    page_type: str,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    assert_any_permission(current_user, ORG_USERS_READ, PLATFORM_USERS_READ)
    
    """Get the default filter for a specific page type"""
    methodLogger = logger.get_method_logger('get_default_filter')
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    methodLogger.info('Getting default filter', extra={
        'user_id': str(current_user.id),
        'organization_id': str(org_id),
        'page_type': page_type
    })
    
    default_filter = await SavedFilterService.get_default_filter(
        db, current_user.id, org_id, page_type
    )
    if not default_filter:
        raise NotFoundError("No default filter found for this page type")
    return success_response(data=default_filter, message=SuccessMessages.RETRIEVED) 