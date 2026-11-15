from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from uuid import UUID

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import get_current_user


from .services import Auth2Service
from .schema import (
    UserSessionsResponse,
    UserTokenInfo,
    UserLoginHistoryResponse,
    LoginStatistics,
    TokenVerificationResponse,
)




# Create router
router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
        429: {"description": "Too Many Requests"}
    }
)

#--------------------------------
# Get Sessions - authenticated
#--------------------------------
@router.get("/me/sessions")
async def get_sessions(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all active sessions for current user
    """
    service = Auth2Service(db)
    
    # Get session_id from token
    current_session_id = current_user.session_id
    if current_session_id:
        current_session_id = int(current_session_id)
    
    sessions = await service.get_user_sessions(
        current_user.id,
        current_session_id
    )
    
    response_data = UserSessionsResponse(
        sessions=sessions,
        total=len(sessions)
    )
    
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=response_data
    )


#--------------------------------
# Revoke Session - authenticated
#--------------------------------
@router.delete("/me/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Revoke a specific session
    """
    service = Auth2Service(db)
    await service.revoke_session(session_id, current_user.id)
    
    return success_response(
        message=SuccessMessages.DELETED,
        data={"revoked": True}
    )



#--------------------------------
# Get Current User - authenticated
#--------------------------------
@router.get("/me")
async def get_current_user_info(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get current user information
    """
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=current_user
    )


#--------------------------------
# Get Login History - authenticated
#--------------------------------
@router.get("/me/login-history")
async def get_login_history(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    include_failed: bool = Query(False, description="Include failed login attempts"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get user's login history for the specified period
    
    - **days**: Number of days to look back (1-365)
    - **include_failed**: Whether to include failed login attempts
    """
    service = Auth2Service(db)
    login_history = await service.get_user_login_history(
        user_id=current_user.id,
        days=days,
        include_failed=include_failed
    )
    
    # Calculate statistics
    successful_logins = sum(1 for login in login_history if login.success)
    failed_logins = len(login_history) - successful_logins
    
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=UserLoginHistoryResponse(
            login_history=login_history,
            total=len(login_history),
            successful_logins=successful_logins,
            failed_logins=failed_logins,
            period_days=days
        )
    )


#--------------------------------
# Get Login Statistics - authenticated
#--------------------------------
@router.get("/me/login-statistics")
async def get_login_statistics(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get user's login statistics for the specified period
    
    - **days**: Number of days to look back (1-365)
    """
    service = Auth2Service(db)
    statistics = await service.get_user_login_statistics(
        user_id=current_user.id,
        days=days
    )
    
    # Convert the raw dictionary to LoginStatistics schema
    login_statistics = LoginStatistics(**statistics)
    
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=login_statistics
    )


#--------------------------------
# Verify Token - authenticated
# Used by Cloudflare Workers to validate tokens
#--------------------------------
@router.get("/verify-token")
async def verify_token(
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """
    Verify the current token and return user/org information.
    
    This endpoint is used by Cloudflare Workers to:
    1. Validate that the token is valid
    2. Get the organization_id for file access control
    
    Returns 401 if token is invalid (handled by get_current_user dependency)
    """
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=TokenVerificationResponse(
            valid=True,
            user_id=str(current_user.id),
            organization_id=str(current_user.organization_id),
            roles=current_user.roles or []
        )
    )