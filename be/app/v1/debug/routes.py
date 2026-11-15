"""
Debug routes for testing and development.
All endpoints require super_admin or org_admin role.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.common.api_response_schema import SuccessMessages, success_response
from app.common.auth_helper import UserTokenInfo, get_current_user
from app.common.business_exceptions import AuthorizationError, NotFoundError, ValidationError

from .services import DebugR2MultipartUploadService

router = APIRouter(
    prefix="/debug",
    tags=["debug"],
)


class DebugMultipartUploadAbortItem(BaseModel):
    key: str
    uploadId: str


class DebugMultipartUploadAbortRequest(BaseModel):
    uploads: list[DebugMultipartUploadAbortItem]


def _require_debug_access(current_user: UserTokenInfo) -> None:
    if not current_user.has_any_role(["org_admin", "super_admin"]):
        raise AuthorizationError("Debug endpoints require org_admin or super_admin")


@router.get("/ping")
async def debug_ping(
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """Minimal health check for the debug module."""
    _require_debug_access(current_user)
    return success_response(
        data={"ok": True, "organizationId": str(current_user.organization_id) if current_user.organization_id else None},
        message=SuccessMessages.RETRIEVED,
    )


@router.get("/media/multipart-uploads")
async def list_debug_multipart_uploads(
    prefix: Optional[str] = Query(
        None,
        description="Optional org-scoped R2 prefix. Defaults to orgs/{orgId}/media/.",
    ),
    min_age_minutes: int = Query(default=120, alias="minAgeMinutes", ge=0, le=10080),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """List stale incomplete R2 multipart uploads for the current organization."""
    _require_debug_access(current_user)
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    result = DebugR2MultipartUploadService.list_stale_uploads(
        org_id,
        prefix=prefix,
        min_age_minutes=min_age_minutes,
        limit=limit,
    )
    return success_response(data=result, message=SuccessMessages.LISTED)


@router.post("/media/multipart-uploads/abort")
async def abort_debug_multipart_uploads(
    request: DebugMultipartUploadAbortRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """Abort selected incomplete R2 multipart uploads for the current organization."""
    _require_debug_access(current_user)
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    if not request.uploads:
        raise ValidationError("Select at least one multipart upload to abort")

    result = DebugR2MultipartUploadService.abort_uploads(
        org_id,
        uploads=[
            {"key": item.key, "uploadId": item.uploadId}
            for item in request.uploads
        ],
    )
    return success_response(data=result, message=SuccessMessages.UPDATED)
