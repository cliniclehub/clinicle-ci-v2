from datetime import datetime
from typing import Dict, Literal, Optional, List
from uuid import UUID
from pydantic import Field
from app.common.base_schema import CamelModel


MediaAssetStatus = Literal["uploaded", "ready", "failed"]
MediaAssetType = Literal["video", "audio", "pdf", "document", "image", "other"]


class InitiateMultipartUploadRequest(CamelModel):
    """Request to initiate a multipart upload"""
    file_name: str = Field(..., description="Original file name")
    file_type: str = Field(..., description="MIME type of the file")
    file_size: int = Field(..., description="Total file size in bytes")
    is_public: bool = Field(default=False, description="Whether the file should be public")
    content_type: Optional[str] = Field(None, description="Content type category (e.g., 'video', 'logo')")


class InitiateMultipartUploadResponse(CamelModel):
    """Response after initiating multipart upload"""
    upload_id: str = Field(..., description="R2 multipart upload ID")
    key: str = Field(..., description="The object key in R2")
    bucket: str = Field(..., description="The bucket name")
    chunk_size: int = Field(..., description="Recommended chunk size in bytes")
    total_parts: int = Field(..., description="Total number of parts expected")


class GetPresignedUrlRequest(CamelModel):
    """Request to get a presigned URL for uploading a part"""
    upload_id: str = Field(..., description="The multipart upload ID")
    key: str = Field(..., description="The object key")
    part_number: int = Field(..., ge=1, le=10000, description="Part number (1-10000)")
    is_public: bool = Field(default=False, description="Whether the file is in the public bucket")


class GetPresignedUrlResponse(CamelModel):
    """Response with presigned URL for uploading"""
    presigned_url: str = Field(..., description="Presigned URL for uploading the part")
    part_number: int = Field(..., description="Part number")
    expires_in: int = Field(..., description="URL expiration time in seconds")


class UploadedPart(CamelModel):
    """Information about an uploaded part"""
    part_number: int = Field(..., ge=1, le=10000)
    etag: str = Field(..., description="ETag returned by R2 after uploading the part")


class CompleteMultipartUploadRequest(CamelModel):
    """Request to complete a multipart upload"""
    upload_id: str = Field(..., description="The multipart upload ID")
    key: str = Field(..., description="The object key")
    parts: List[UploadedPart] = Field(..., description="List of uploaded parts with ETags")
    is_public: bool = Field(default=False, description="Whether the file is in the public bucket")
    metadata: Optional[dict] = Field(None, description="Additional metadata to store with the file")


class CompleteMultipartUploadResponse(CamelModel):
    """Response after completing multipart upload"""
    key: str = Field(..., description="The object key")
    url: str = Field(..., description="URL to access the file")
    size: int = Field(..., description="Total file size")
    etag: str = Field(..., description="Final ETag of the object")
    mimetype: Optional[str] = Field(default=None, description="Stored object MIME type")
    media_asset_id: Optional[UUID] = Field(default=None, alias="mediaAssetId")


class AbortMultipartUploadRequest(CamelModel):
    """Request to abort a multipart upload"""
    upload_id: str = Field(..., description="The multipart upload ID")
    key: str = Field(..., description="The object key")
    is_public: bool = Field(default=False, description="Whether the file is in the public bucket")


class AbortMultipartUploadResponse(CamelModel):
    """Response after aborting multipart upload"""
    success: bool = Field(..., description="Whether the abort was successful")
    message: str = Field(..., description="Status message")


class MediaSignAccessRequest(CamelModel):
    """Request a scoped playback URL for one private R2 object."""

    media_url: Optional[str] = Field(
        default=None,
        description="Existing private worker URL. Preferred because it preserves the configured worker origin.",
    )
    object_key: Optional[str] = Field(
        default=None,
        description="R2 object key, e.g. orgs/{orgId}/media/file.mp4.",
    )
    asset_id: Optional[UUID] = Field(
        default=None,
        description="Media asset ID. When present, signs the asset source object.",
    )


class MediaSignAccessResponse(CamelModel):
    """Scoped media token and tokenized private worker URL."""

    playback_url: str = Field(..., alias="playbackUrl")
    object_key: str = Field(..., alias="objectKey")
    expires_in: int = Field(..., alias="expiresIn")
    expires_at: datetime = Field(..., alias="expiresAt")
    delivery: str = Field(default="object")


class MediaAssetCreateRequest(CamelModel):
    """Create or retrieve tracking for a private media object."""

    source_object_key: Optional[str] = Field(default=None, alias="sourceObjectKey")
    media_url: Optional[str] = Field(default=None, alias="mediaUrl")
    media_type: Optional[MediaAssetType] = Field(default=None, alias="mediaType")
    source_mime_type: Optional[str] = Field(default=None, alias="sourceMimeType")
    source_size_bytes: Optional[int] = Field(default=None, alias="sourceSizeBytes")


class MediaAssetRenameRequest(CamelModel):
    """Rename a private media asset source object within its current media folder."""

    file_name: str = Field(..., alias="fileName", min_length=1, max_length=255)


class MediaAssetData(CamelModel):
    id: UUID
    organization_id: UUID = Field(..., alias="organizationId")
    source_object_key: str = Field(..., alias="sourceObjectKey")
    display_name: Optional[str] = Field(default=None, alias="displayName")
    source_url: Optional[str] = Field(default=None, alias="sourceUrl")
    media_type: MediaAssetType = Field(..., alias="mediaType")
    source_mime_type: Optional[str] = Field(default=None, alias="sourceMimeType")
    source_size_bytes: Optional[int] = Field(default=None, alias="sourceSizeBytes")
    status: MediaAssetStatus
    created_by: Optional[UUID] = Field(default=None, alias="createdBy")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")


class MediaAssetListData(CamelModel):
    assets: List[MediaAssetData] = Field(default_factory=list)


class MediaAssetDeleteData(CamelModel):
    asset_id: UUID = Field(..., alias="assetId")
    source_object_key: str = Field(..., alias="sourceObjectKey")
    deleted_source_object: bool = Field(default=False, alias="deletedSourceObject")


class MediaAssetRenameData(CamelModel):
    asset: MediaAssetData
    old_source_object_key: str = Field(..., alias="oldSourceObjectKey")
    new_source_object_key: str = Field(..., alias="newSourceObjectKey")
    old_display_name: Optional[str] = Field(default=None, alias="oldDisplayName")
    new_display_name: str = Field(..., alias="newDisplayName")


class MediaLibraryReconcileItem(CamelModel):
    action: str = Field(
        ...,
        description=(
            "ok | wouldCreate | wouldRefreshSize | missingInR2 | created | updated | error"
        ),
    )
    object_key: str = Field(..., alias="objectKey")
    asset_id: Optional[UUID] = Field(default=None, alias="assetId")
    display_name: str = Field(..., alias="displayName")
    db_size_bytes: Optional[int] = Field(default=None, alias="dbSizeBytes")
    r2_size_bytes: Optional[int] = Field(default=None, alias="r2SizeBytes")
    error: Optional[str] = None


class MediaLibraryReconcileData(CamelModel):
    dry_run: bool = Field(True, alias="dryRun")
    r2_scanned: int = Field(0, alias="r2Scanned")
    db_scanned: int = Field(0, alias="dbScanned")
    matched: int = 0
    r2_only: int = Field(0, alias="r2Only")
    db_only: int = Field(0, alias="dbOnly")
    size_refresh: int = Field(0, alias="sizeRefresh")
    created: int = 0
    updated: int = 0
    errors: int = 0
    items: List[MediaLibraryReconcileItem] = Field(default_factory=list)
