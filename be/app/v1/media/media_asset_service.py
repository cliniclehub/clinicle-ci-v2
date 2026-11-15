"""Services for private media asset tracking."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Optional
from uuid import UUID

from botocore.exceptions import ClientError
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.common.app_logger import get_logger
from app.common.business_exceptions import AuthorizationError, NotFoundError, ValidationError
from app.common.config import R2_BUCKET_NAME, R2_MEDIA_SERVER_WORKER_URL
from app.v1.auth.schema import UserTokenInfo
from app.v1.media.media_access_service import MediaAccessService
from app.v1.media.media_asset_model import MediaAsset
from app.v1.media.schema import MediaAssetData, MediaAssetDeleteData, MediaAssetRenameData

_MEDIA_TYPES = {"video", "audio", "pdf", "document", "image", "other"}
logger = get_logger(__name__)


class MediaAssetService:
    """Create, read, and update private media asset tracking rows."""

    @staticmethod
    def build_worker_url(object_key: Optional[str]) -> Optional[str]:
        if not object_key:
            return None
        worker_url = (R2_MEDIA_SERVER_WORKER_URL or "").strip().rstrip("/")
        return f"{worker_url}/{object_key}" if worker_url else object_key

    @staticmethod
    def _is_missing_object_error(error: Exception) -> bool:
        if not isinstance(error, ClientError):
            return False
        code = str(error.response.get("Error", {}).get("Code", ""))
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"404", "NoSuchKey", "NotFound"} or status == 404

    @staticmethod
    def _object_exists(client, object_key: str) -> bool:
        try:
            client.head_object(Bucket=R2_BUCKET_NAME, Key=object_key)
            return True
        except Exception as exc:
            if MediaAssetService._is_missing_object_error(exc):
                return False
            raise

    @staticmethod
    def _copy_r2_object(client, *, source_key: str, destination_key: str, original_name: Optional[str] = None) -> None:
        head = client.head_object(Bucket=R2_BUCKET_NAME, Key=source_key)
        metadata = dict(head.get("Metadata") or {})
        if original_name:
            metadata["originalname"] = original_name
        client.copy_object(
            Bucket=R2_BUCKET_NAME,
            CopySource={"Bucket": R2_BUCKET_NAME, "Key": source_key},
            Key=destination_key,
            ContentType=head.get("ContentType") or "application/octet-stream",
            Metadata=metadata,
            MetadataDirective="REPLACE",
        )

    @staticmethod
    def _update_r2_original_name_metadata(client, *, object_key: str, original_name: str) -> None:
        MediaAssetService._copy_r2_object(
            client,
            source_key=object_key,
            destination_key=object_key,
            original_name=original_name,
        )

    @staticmethod
    def effective_media_type_for_asset(asset: MediaAsset) -> str:
        requested_media_type = asset.media_type if asset.media_type != "other" else None
        return MediaAssetService.infer_media_type(
            source_mime_type=asset.source_mime_type,
            source_object_key=asset.source_object_key,
            requested_media_type=requested_media_type,
        )

    @staticmethod
    def _asset_to_data(
        asset: MediaAsset,
        *,
        current_user: Optional[UserTokenInfo] = None,
    ) -> MediaAssetData:
        del current_user
        return MediaAssetData(
            id=asset.id,
            organization_id=asset.organization_id,
            source_object_key=asset.source_object_key,
            display_name=asset.display_name,
            source_url=MediaAssetService.build_worker_url(asset.source_object_key),
            media_type=MediaAssetService.effective_media_type_for_asset(asset),
            source_mime_type=asset.source_mime_type,
            source_size_bytes=asset.source_size_bytes,
            status=asset.status,
            created_by=asset.created_by,
            created_at=asset.created_at,
            updated_at=asset.updated_at,
        )

    @staticmethod
    def infer_media_type(
        *,
        source_mime_type: Optional[str] = None,
        source_object_key: Optional[str] = None,
        requested_media_type: Optional[str] = None,
    ) -> str:
        requested = (requested_media_type or "").strip().lower()
        if requested in _MEDIA_TYPES and requested != "other":
            return requested

        mime = (source_mime_type or "").strip().lower()
        if mime.startswith("video/"):
            return "video"
        if mime.startswith("audio/"):
            return "audio"
        if mime == "application/pdf":
            return "pdf"
        if mime.startswith("image/"):
            return "image"
        if mime in {
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/plain",
            "text/csv",
        }:
            return "document"

        suffix = PurePosixPath(source_object_key or "").suffix.lower()
        if suffix in {".mp4", ".m4v", ".mov", ".webm"}:
            return "video"
        if suffix in {".mp3", ".m4a", ".wav", ".aac", ".ogg"}:
            return "audio"
        if suffix == ".pdf":
            return "pdf"
        if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}:
            return "image"
        if suffix in {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv"}:
            return "document"
        return "other"

    @staticmethod
    def normalize_source_object_key(
        *,
        current_user: UserTokenInfo,
        source_object_key: Optional[str] = None,
        media_url: Optional[str] = None,
    ) -> str:
        org_id = current_user.organization_id
        if not org_id:
            raise AuthorizationError("Organization not found in token")
        roles = set(current_user.roles or [])
        key = MediaAccessService.normalize_object_key(
            object_key=source_object_key,
            media_url=media_url,
            organization_id=org_id,
            allow_any_org="super_admin" in roles,
        )
        if "/media/" not in key:
            raise ValidationError("Media assets can only be created for private media objects")
        return key

    @staticmethod
    def get_asset(db: Session, *, asset_id: UUID, organization_id: Optional[UUID] = None) -> MediaAsset:
        query = db.query(MediaAsset).filter(MediaAsset.id == asset_id)
        if organization_id:
            query = query.filter(MediaAsset.organization_id == organization_id)
        asset = query.first()
        if not asset:
            raise NotFoundError("Media asset not found")
        return asset

    @staticmethod
    def get_asset_for_signing(
        db: Session,
        *,
        current_user: UserTokenInfo,
        asset_id: UUID,
    ) -> MediaAsset:
        org_id = current_user.organization_id
        if not org_id:
            raise AuthorizationError("Organization not found in token")
        roles = set(current_user.roles or [])
        return MediaAssetService.get_asset(
            db,
            asset_id=asset_id,
            organization_id=None if "super_admin" in roles else org_id,
        )

    @staticmethod
    def find_asset_by_source(
        db: Session,
        *,
        organization_id: UUID,
        source_object_key: str,
        ready_only: bool = False,
    ) -> Optional[MediaAsset]:
        query = db.query(MediaAsset).filter(
            and_(
                MediaAsset.organization_id == organization_id,
                MediaAsset.source_object_key == source_object_key,
            )
        )
        if ready_only:
            query = query.filter(MediaAsset.status == "ready")
        return query.order_by(MediaAsset.created_at.desc()).first()

    @staticmethod
    def create_or_get_asset(
        db: Session,
        *,
        current_user: UserTokenInfo,
        source_object_key: Optional[str] = None,
        media_url: Optional[str] = None,
        media_type: Optional[str] = None,
        source_mime_type: Optional[str] = None,
        source_size_bytes: Optional[int] = None,
    ) -> MediaAssetData:
        key = MediaAssetService.normalize_source_object_key(
            current_user=current_user,
            source_object_key=source_object_key,
            media_url=media_url,
        )
        org_id = MediaAccessService.organization_id_from_object_key(key)
        mime = (source_mime_type or "").strip() or None
        resolved_media_type = MediaAssetService.infer_media_type(
            source_mime_type=mime,
            source_object_key=key,
            requested_media_type=media_type,
        )
        asset = MediaAssetService.create_or_get_asset_for_source(
            db,
            organization_id=org_id,
            source_object_key=key,
            media_type=resolved_media_type,
            source_mime_type=mime,
            source_size_bytes=source_size_bytes,
            created_by=current_user.id,
        )
        return MediaAssetService._asset_to_data(asset, current_user=current_user)

    @staticmethod
    def create_or_get_asset_for_source(
        db: Session,
        *,
        organization_id: UUID,
        source_object_key: str,
        media_type: Optional[str] = None,
        source_mime_type: Optional[str] = None,
        source_size_bytes: Optional[int] = None,
        created_by: Optional[UUID] = None,
    ) -> MediaAsset:
        key = (source_object_key or "").strip().lstrip("/")
        if not key:
            raise ValidationError("source_object_key is required")
        key_org_id = MediaAccessService.organization_id_from_object_key(key)
        if key_org_id != organization_id:
            raise AuthorizationError("You are not authorized to create this media asset")
        if "/media/" not in key:
            raise ValidationError("Media assets can only be created for private media objects")

        mime = (source_mime_type or "").strip() or None
        resolved_media_type = MediaAssetService.infer_media_type(
            source_mime_type=mime,
            source_object_key=key,
            requested_media_type=media_type,
        )

        existing = MediaAssetService.find_asset_by_source(
            db,
            organization_id=organization_id,
            source_object_key=key,
        )
        if existing:
            changed = False
            if not getattr(existing, "display_name", None):
                existing.display_name = PurePosixPath(key).name
                changed = True
            if resolved_media_type and existing.media_type != resolved_media_type:
                existing.media_type = resolved_media_type
                changed = True
            if mime and existing.source_mime_type != mime:
                existing.source_mime_type = mime
                changed = True
            if source_size_bytes and existing.source_size_bytes != source_size_bytes:
                existing.source_size_bytes = source_size_bytes
                changed = True
            if existing.status == "uploaded":
                existing.status = "ready"
                changed = True
            if changed:
                existing.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(existing)
            return existing

        asset = MediaAsset(
            id=uuid.uuid4(),
            organization_id=organization_id,
            source_object_key=key,
            display_name=PurePosixPath(key).name,
            media_type=resolved_media_type,
            source_mime_type=mime,
            source_size_bytes=source_size_bytes,
            status="ready",
            created_by=created_by,
        )
        db.add(asset)
        try:
            db.commit()
            db.refresh(asset)
            return asset
        except IntegrityError:
            db.rollback()
            existing = MediaAssetService.find_asset_by_source(
                db,
                organization_id=organization_id,
                source_object_key=key,
            )
            if existing:
                return existing
            raise

    @staticmethod
    def list_assets(
        db: Session,
        *,
        organization_id: UUID,
        status: Optional[str] = None,
        media_type: Optional[str] = None,
        limit: int = 100,
        current_user: Optional[UserTokenInfo] = None,
    ) -> list[MediaAssetData]:
        query = db.query(MediaAsset).filter(MediaAsset.organization_id == organization_id)
        if status:
            query = query.filter(MediaAsset.status == status)
        if media_type:
            query = query.filter(MediaAsset.media_type == media_type)
        assets = query.order_by(MediaAsset.created_at.desc()).limit(limit).all()
        return [
            MediaAssetService._asset_to_data(asset, current_user=current_user)
            for asset in assets
        ]

    @staticmethod
    def rename_asset(
        db: Session,
        *,
        asset_id: UUID,
        organization_id: UUID,
        file_name: str,
        current_user: Optional[UserTokenInfo] = None,
    ) -> MediaAssetRenameData:
        asset = MediaAssetService.get_asset(
            db,
            asset_id=asset_id,
            organization_id=organization_id,
        )

        requested_name = (file_name or "").strip()
        if not requested_name:
            raise ValidationError("File name is required")
        if "/" in requested_name or "\\" in requested_name:
            raise ValidationError("File name cannot contain folders")

        old_key = asset.source_object_key
        old_path = PurePosixPath(old_key)
        old_suffix = old_path.suffix
        requested_path = PurePosixPath(requested_name)
        final_name = requested_name if requested_path.suffix else f"{requested_name}{old_suffix}"
        if final_name in {"", ".", ".."}:
            raise ValidationError("Invalid file name")

        old_display_name = getattr(asset, "display_name", None) or old_path.name
        if final_name == old_display_name:
            return MediaAssetRenameData(
                asset=MediaAssetService._asset_to_data(asset, current_user=current_user),
                old_source_object_key=old_key,
                new_source_object_key=old_key,
                old_display_name=old_display_name,
                new_display_name=final_name,
            )

        asset.display_name = final_name
        asset.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(asset)

        if R2_BUCKET_NAME:
            try:
                from app.v1.media.services import get_r2_client

                client = get_r2_client()
                MediaAssetService._update_r2_original_name_metadata(
                    client,
                    object_key=old_key,
                    original_name=final_name,
                )
            except Exception:
                logger.warning(
                    "Failed to update R2 originalName metadata during media asset rename",
                    exc_info=True,
                    extra={"asset_id": str(asset.id), "source_object_key": old_key},
                )

        return MediaAssetRenameData(
            asset=MediaAssetService._asset_to_data(asset, current_user=current_user),
            old_source_object_key=old_key,
            new_source_object_key=old_key,
            old_display_name=old_display_name,
            new_display_name=final_name,
        )

    @staticmethod
    def delete_asset(
        db: Session,
        *,
        asset_id: UUID,
        organization_id: UUID,
    ) -> MediaAssetDeleteData:
        asset = MediaAssetService.get_asset(
            db,
            asset_id=asset_id,
            organization_id=organization_id,
        )
        if not R2_BUCKET_NAME:
            raise ValidationError("R2 bucket not configured")

        from app.v1.media.services import get_r2_client

        client = get_r2_client()
        client.delete_object(Bucket=R2_BUCKET_NAME, Key=asset.source_object_key)
        source_object_key = asset.source_object_key
        db.delete(asset)
        db.commit()
        return MediaAssetDeleteData(
            asset_id=asset_id,
            source_object_key=source_object_key,
            deleted_source_object=True,
        )
