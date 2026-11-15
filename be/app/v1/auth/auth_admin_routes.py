from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from uuid import UUID

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import assert_any_permission, get_current_user
from app.common.business_exceptions import AuthorizationError
from app.v1.auth.permissions import ORG_USERS_WRITE, PLATFORM_USERS_WRITE

from .services import Auth2Service
from .schema import (
    UserSessionsResponse,
    UserTokenInfo,
    UserLoginHistoryResponse,
    LoginStatistics,
)


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


def _assert_user_admin_access(current_user: UserTokenInfo, target_user_id: UUID, db: Session) -> None:
    assert_any_permission(current_user, ORG_USERS_WRITE, PLATFORM_USERS_WRITE)
    if current_user.has_permission(PLATFORM_USERS_WRITE):
        return
    if not current_user.organization_id:
        raise AuthorizationError("You are not authorized to access this endpoint")
    from app.v1.users.model import User

    user = db.query(User).filter(User.id == target_user_id).first()
    if not user or user.organization_id != current_user.organization_id:
        raise AuthorizationError("You are not authorized to access this endpoint")


#--------------------------------
# Get Sessions - authenticated
#--------------------------------
@router.get("/admin/sessions/{user_id}")
async def get_sessions(
    user_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active sessions for a user (user-admin permissions)."""
    _assert_user_admin_access(current_user, user_id, db)

    service = Auth2Service(db)
    sessions = await service.get_user_sessions(user_id, None)
    response_data = UserSessionsResponse(sessions=sessions, total=len(sessions))
    return success_response(message=SuccessMessages.RETRIEVED, data=response_data)


@router.delete("/admin/sessions/{session_id}/{user_id}")
async def revoke_session(
    session_id: int,
    user_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke a specific session."""
    _assert_user_admin_access(current_user, user_id, db)

    service = Auth2Service(db)
    await service.revoke_session(session_id, user_id)
    return success_response(message=SuccessMessages.DELETED, data={"revoked": True})


@router.get("/admin/login-history/{user_id}")
async def get_login_history(
    user_id: UUID,
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    include_failed: bool = Query(False, description="Include failed login attempts"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's login history for the specified period."""
    _assert_user_admin_access(current_user, user_id, db)

    service = Auth2Service(db)
    login_history = await service.get_user_login_history(
        user_id=user_id,
        days=days,
        include_failed=include_failed,
    )
    successful_logins = sum(1 for login in login_history if login.success)
    failed_logins = len(login_history) - successful_logins
    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=UserLoginHistoryResponse(
            login_history=login_history,
            total=len(login_history),
            successful_logins=successful_logins,
            failed_logins=failed_logins,
            period_days=days,
        ),
    )


@router.get("/admin/login-statistics/{user_id}")
async def get_login_statistics(
    user_id: UUID,
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's login statistics for the specified period."""
    _assert_user_admin_access(current_user, user_id, db)

    service = Auth2Service(db)
    statistics = await service.get_user_login_statistics(user_id=user_id, days=days)
    login_statistics = LoginStatistics(**statistics)
    return success_response(message=SuccessMessages.RETRIEVED, data=login_statistics)
