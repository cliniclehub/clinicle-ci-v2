from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.config import AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES, AUTH2_REFRESH_TOKEN_EXPIRE_DAYS

from .services import Auth2Service
from .schema import OAuthCompleteRequest, LoginResponse, TokenResponse


# Create router — mounted under /auth/oauth by the v1 router
router = APIRouter(
    prefix="/auth/oauth",
    tags=["OAuth Authentication"],
    responses={
        401: {"description": "Unauthorized"},
        409: {"description": "Conflict — account exists with different auth method"},
    },
)


@router.post("/{provider}/complete")
async def oauth_complete(
    provider: str,
    data: OAuthCompleteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Complete an OAuth login or registration.

    The Next.js frontend exchanges the authorization code with the provider,
    then sends the raw ID-token here for verification + user upsert.

    Supported providers: google (more coming).
    """
    service = Auth2Service(db)

    # Verify token + find-or-create user
    user, org = await service.oauth_login_or_register(provider, data, request)

    # Generate session tokens (same as password login)
    device_info = dict(data.device_info or {})
    access_token, refresh_token = await service.generate_tokens(user, org, device_info)

    # Build response (identical shape to POST /auth/login)
    user_info = service.build_user_info(user, org)

    response_data = LoginResponse(
        tokens=TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="Bearer",
            expires_in=AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_expires_in=AUTH2_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        ),
        user=user_info,
    )

    return success_response(
        message=SuccessMessages.RETRIEVED,
        data=response_data,
    )
