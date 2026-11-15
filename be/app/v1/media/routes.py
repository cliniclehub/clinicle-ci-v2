from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.app_logger import get_logger
from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import assert_any_permission, get_current_user, UserTokenInfo
from app.v1.auth.permissions import ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE
from app.common.business_exceptions import AuthorizationError, NotFoundError
from .media_reconcile_service import MediaLibraryReconcileService
from .schema import (
    MediaAssetCreateRequest,
    MediaAssetDeleteData,
    MediaAssetListData,
    MediaAssetRenameData,
    MediaAssetRenameRequest,
    MediaSignAccessRequest,
    MediaSignAccessResponse,
    InitiateMultipartUploadRequest,
    InitiateMultipartUploadResponse,
    GetPresignedUrlRequest,
    GetPresignedUrlResponse,
    CompleteMultipartUploadRequest,
    CompleteMultipartUploadResponse,
    AbortMultipartUploadRequest,
    AbortMultipartUploadResponse,
    MediaLibraryReconcileData,
)
from .media_access_service import MediaAccessService
from .media_asset_service import MediaAssetService
from .services import MultipartUploadService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/media",
    tags=["media"]
)

from app.v1.auth.org_roles import MEDIA_MANAGER_ROLES


def _require_media_manager_access(current_user: UserTokenInfo) -> UUID:
    assert_any_permission(current_user, ORG_MEDIA_MANAGE, PLATFORM_SETTINGS_MANAGE)
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    return org_id


@router.post("/sign-access")
async def sign_media_access(
    request: MediaSignAccessRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mint a scoped media token for one private R2 object."""
    data = MediaAccessService.sign_access_url(
        db,
        current_user=current_user,
        media_url=request.media_url,
        object_key=request.object_key,
        asset_id=request.asset_id,
    )
    return success_response(
        data=MediaSignAccessResponse(**data),
        message=SuccessMessages.RETRIEVED,
    )


@router.post("/assets")
async def create_or_get_media_asset(
    request: MediaAssetCreateRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create or retrieve tracking for one private media object."""
    _require_media_manager_access(current_user)
    data = MediaAssetService.create_or_get_asset(
        db,
        current_user=current_user,
        source_object_key=request.source_object_key,
        media_url=request.media_url,
        media_type=request.media_type,
        source_mime_type=request.source_mime_type,
        source_size_bytes=request.source_size_bytes,
    )
    return success_response(data=data, message=SuccessMessages.RETRIEVED)


@router.get("/assets")
async def list_media_assets(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    media_type: Optional[str] = Query(default=None, alias="mediaType"),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List media assets for the current organization."""
    org_id = _require_media_manager_access(current_user)
    assets = MediaAssetService.list_assets(
        db,
        organization_id=org_id,
        status=status_filter,
        media_type=media_type,
        limit=limit,
        current_user=current_user,
    )
    return success_response(
        data=MediaAssetListData(assets=assets),
        message=SuccessMessages.LISTED,
    )


@router.post("/assets/reconcile")
async def reconcile_media_library(
    dry_run: bool = Query(True, alias="dryRun"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Diff private R2 media objects against media_assets; optionally create rows and fill sizes."""
    org_id = _require_media_manager_access(current_user)
    data = MediaLibraryReconcileService.reconcile(
        db,
        organization_id=org_id,
        dry_run=dry_run,
        created_by=current_user.id,
    )
    return success_response(
        data=MediaLibraryReconcileData.model_validate(data),
        message=SuccessMessages.RETRIEVED if dry_run else SuccessMessages.UPDATED,
    )


@router.get("/assets/{asset_id}")
async def get_media_asset(
    asset_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get one media asset."""
    org_id = _require_media_manager_access(current_user)
    asset = MediaAssetService.get_asset(
        db,
        asset_id=asset_id,
        organization_id=org_id,
    )
    return success_response(
        data=MediaAssetService._asset_to_data(asset, current_user=current_user),
        message=SuccessMessages.RETRIEVED,
    )


@router.delete("/assets/{asset_id}")
async def delete_media_asset(
    asset_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an unused private media asset and its source object."""
    org_id = _require_media_manager_access(current_user)
    data = MediaAssetService.delete_asset(
        db,
        asset_id=asset_id,
        organization_id=org_id,
    )
    return success_response(
        data=MediaAssetDeleteData.model_validate(data),
        message=SuccessMessages.DELETED,
    )


@router.patch("/assets/{asset_id}/rename")
async def rename_media_asset(
    asset_id: UUID,
    request: MediaAssetRenameRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename a private media asset display name and R2 originalName metadata."""
    org_id = _require_media_manager_access(current_user)
    data = MediaAssetService.rename_asset(
        db,
        asset_id=asset_id,
        organization_id=org_id,
        file_name=request.file_name,
        current_user=current_user,
    )
    return success_response(
        data=MediaAssetRenameData.model_validate(data),
        message=SuccessMessages.UPDATED,
    )


@router.post("/multipart/initiate/")
async def initiate_multipart_upload(
    request: InitiateMultipartUploadRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Initiate a multipart upload for large files."""
    org_id = _require_media_manager_access(current_user)

    result = await MultipartUploadService.initiate_multipart_upload(
        org_id=org_id,
        file_name=request.file_name,
        file_type=request.file_type,
        file_size=request.file_size,
        is_public=request.is_public,
        content_type=request.content_type
    )

    return success_response(
        data=InitiateMultipartUploadResponse(**result),
        message="Multipart upload initiated successfully"
    )


@router.post("/multipart/presigned-url/")
async def get_presigned_url(
    request: GetPresignedUrlRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a presigned URL for uploading a specific part."""
    org_id = _require_media_manager_access(current_user)

    MultipartUploadService.validate_object_key_for_org(
        org_id, request.key, is_public=request.is_public
    )

    result = await MultipartUploadService.get_presigned_url_for_part(
        upload_id=request.upload_id,
        key=request.key,
        part_number=request.part_number,
        is_public=request.is_public
    )

    return success_response(
        data=GetPresignedUrlResponse(**result),
        message="Presigned URL generated successfully"
    )


@router.post("/multipart/presigned-urls/batch/")
async def get_presigned_urls_batch(
    upload_id: str,
    key: str,
    part_numbers: List[int],
    is_public: bool = False,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get multiple presigned URLs at once for parallel uploads."""
    org_id = _require_media_manager_access(current_user)

    MultipartUploadService.validate_object_key_for_org(org_id, key, is_public=is_public)

    urls = []
    for part_number in part_numbers:
        result = await MultipartUploadService.get_presigned_url_for_part(
            upload_id=upload_id,
            key=key,
            part_number=part_number,
            is_public=is_public
        )
        urls.append(GetPresignedUrlResponse(**result))

    return success_response(
        data={"urls": urls},
        message="Presigned URLs generated successfully"
    )


@router.post("/multipart/complete/")
async def complete_multipart_upload(
    request: CompleteMultipartUploadRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Complete a multipart upload after all parts have been uploaded."""
    org_id = _require_media_manager_access(current_user)

    MultipartUploadService.validate_object_key_for_org(
        org_id, request.key, is_public=request.is_public
    )

    parts = [{"part_number": p.part_number, "etag": p.etag} for p in request.parts]

    result = await MultipartUploadService.complete_multipart_upload(
        upload_id=request.upload_id,
        key=request.key,
        parts=parts,
        is_public=request.is_public,
        metadata=request.metadata
    )

    mimetype = result.get("mimetype") or ""
    if not request.is_public:
        asset = MediaAssetService.create_or_get_asset(
            db,
            current_user=current_user,
            source_object_key=result["key"],
            source_mime_type=mimetype,
            source_size_bytes=result.get("size"),
        )
        result["mediaAssetId"] = str(asset.id)

    return success_response(
        data=CompleteMultipartUploadResponse(**result),
        message="Upload completed successfully"
    )


@router.post("/multipart/abort/")
async def abort_multipart_upload(
    request: AbortMultipartUploadRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Abort a multipart upload. This cleans up any uploaded parts."""
    org_id = _require_media_manager_access(current_user)

    MultipartUploadService.validate_object_key_for_org(
        org_id, request.key, is_public=request.is_public
    )

    result = await MultipartUploadService.abort_multipart_upload(
        upload_id=request.upload_id,
        key=request.key,
        is_public=request.is_public
    )

    return success_response(
        data=AbortMultipartUploadResponse(**result),
        message="Upload aborted"
    )
