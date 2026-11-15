"""Reconcile private R2 media objects with the media_assets table."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Dict, List, Optional, Set, Tuple
from uuid import UUID

from botocore.exceptions import ClientError
from sqlalchemy.orm import Session

from app.common.app_logger import get_logger
from app.common.business_exceptions import ValidationError
from app.common.config import R2_BUCKET_NAME
from app.v1.media.media_asset_model import MediaAsset
from app.v1.media.media_asset_service import MediaAssetService
from app.v1.media.schema import MediaLibraryReconcileData, MediaLibraryReconcileItem
from app.v1.media.services import get_r2_client

logger = get_logger(__name__)

_ITEMS_CAP = 200
_THUMB_SUFFIX = "_thumb.jpg"


class MediaLibraryReconcileService:
    """Diff org private media R2 objects against media_assets; optionally apply fixes."""

    @staticmethod
    def _is_source_media_key(key: str, *, organization_id: UUID) -> bool:
        prefix = f"orgs/{organization_id}/media/"
        if not key.startswith(prefix):
            return False
        if key.endswith("/") or key == prefix:
            return False
        if key.endswith(_THUMB_SUFFIX):
            return False
        # HLS packages live under media-hls/, not media/
        return True

    @staticmethod
    def _list_r2_source_objects(organization_id: UUID) -> Dict[str, int]:
        """Return source_object_key -> size_bytes for private media objects."""
        if not R2_BUCKET_NAME:
            raise ValidationError("R2 bucket not configured")

        client = get_r2_client()
        prefix = f"orgs/{organization_id}/media/"
        objects: Dict[str, int] = {}
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=R2_BUCKET_NAME, Prefix=prefix):
            for obj in page.get("Contents") or []:
                key = str(obj.get("Key") or "").strip()
                if not MediaLibraryReconcileService._is_source_media_key(
                    key, organization_id=organization_id
                ):
                    continue
                size = obj.get("Size")
                objects[key] = int(size) if size is not None else 0
        return objects

    @staticmethod
    def _head_metadata(object_key: str) -> Tuple[Optional[str], Optional[int], Optional[str]]:
        if not R2_BUCKET_NAME:
            return None, None, "R2 bucket not configured"
        try:
            response = get_r2_client().head_object(Bucket=R2_BUCKET_NAME, Key=object_key)
            return response.get("ContentType"), response.get("ContentLength"), None
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
                return None, None, "R2 object not found"
            if code in {"403", "AccessDenied"} or status == 403:
                return None, None, "R2 metadata lookup denied"
            logger.get_method_logger("_head_metadata").warning(
                "Failed to read R2 metadata during library reconcile",
                exc_info=True,
                extra={"source_object_key": object_key, "r2_error_code": code},
            )
            return None, None, "R2 metadata lookup failed"
        except Exception:
            logger.get_method_logger("_head_metadata").warning(
                "Failed to read R2 metadata during library reconcile",
                exc_info=True,
                extra={"source_object_key": object_key},
            )
            return None, None, "R2 metadata lookup failed"

    @staticmethod
    def _needs_size_refresh(db_size: Optional[int], r2_size: Optional[int]) -> bool:
        if r2_size is None:
            return False
        if db_size is None:
            return True
        return int(db_size) != int(r2_size)

    @staticmethod
    def _append_item(
        items: List[MediaLibraryReconcileItem],
        item: MediaLibraryReconcileItem,
    ) -> None:
        if len(items) < _ITEMS_CAP:
            items.append(item)

    @staticmethod
    def reconcile(
        db: Session,
        *,
        organization_id: UUID,
        dry_run: bool = True,
        created_by: Optional[UUID] = None,
    ) -> MediaLibraryReconcileData:
        method_logger = logger.get_method_logger("reconcile")
        r2_objects = MediaLibraryReconcileService._list_r2_source_objects(organization_id)
        assets = (
            db.query(MediaAsset)
            .filter(MediaAsset.organization_id == organization_id)
            .all()
        )
        assets_by_key: Dict[str, MediaAsset] = {
            asset.source_object_key: asset for asset in assets if asset.source_object_key
        }

        items: List[MediaLibraryReconcileItem] = []
        matched = 0
        r2_only = 0
        db_only = 0
        size_refresh = 0
        created = 0
        updated = 0
        errors = 0

        r2_keys: Set[str] = set(r2_objects.keys())

        for key, r2_size in sorted(r2_objects.items()):
            asset = assets_by_key.get(key)
            display = (
                (asset.display_name if asset and asset.display_name else None)
                or PurePosixPath(key).name
            )

            if asset is None:
                r2_only += 1
                if dry_run:
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="wouldCreate",
                            object_key=key,
                            display_name=display,
                            r2_size_bytes=r2_size,
                        ),
                    )
                    continue

                mime, head_size, head_error = MediaLibraryReconcileService._head_metadata(key)
                if head_error:
                    errors += 1
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="error",
                            object_key=key,
                            display_name=display,
                            r2_size_bytes=r2_size,
                            error=head_error,
                        ),
                    )
                    continue
                try:
                    new_asset = MediaAssetService.create_or_get_asset_for_source(
                        db,
                        organization_id=organization_id,
                        source_object_key=key,
                        source_mime_type=mime,
                        source_size_bytes=head_size if head_size is not None else r2_size,
                        created_by=created_by,
                    )
                    created += 1
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="created",
                            object_key=key,
                            asset_id=new_asset.id,
                            display_name=new_asset.display_name or display,
                            db_size_bytes=new_asset.source_size_bytes,
                            r2_size_bytes=head_size if head_size is not None else r2_size,
                        ),
                    )
                except Exception as exc:
                    errors += 1
                    method_logger.warning(
                        "Failed to create media asset during reconcile",
                        exc_info=True,
                        extra={"source_object_key": key},
                    )
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="error",
                            object_key=key,
                            display_name=display,
                            r2_size_bytes=r2_size,
                            error=str(exc) or "create_failed",
                        ),
                    )
                continue

            db_size = asset.source_size_bytes
            if MediaLibraryReconcileService._needs_size_refresh(db_size, r2_size):
                size_refresh += 1
                if dry_run:
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="wouldRefreshSize",
                            object_key=key,
                            asset_id=asset.id,
                            display_name=display,
                            db_size_bytes=db_size,
                            r2_size_bytes=r2_size,
                        ),
                    )
                    continue

                mime, head_size, head_error = MediaLibraryReconcileService._head_metadata(key)
                if head_error:
                    errors += 1
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="error",
                            object_key=key,
                            asset_id=asset.id,
                            display_name=display,
                            db_size_bytes=db_size,
                            r2_size_bytes=r2_size,
                            error=head_error,
                        ),
                    )
                    continue
                try:
                    refreshed = MediaAssetService.create_or_get_asset_for_source(
                        db,
                        organization_id=organization_id,
                        source_object_key=key,
                        source_mime_type=mime or asset.source_mime_type,
                        source_size_bytes=head_size if head_size is not None else r2_size,
                        created_by=created_by,
                    )
                    updated += 1
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="updated",
                            object_key=key,
                            asset_id=refreshed.id,
                            display_name=refreshed.display_name or display,
                            db_size_bytes=refreshed.source_size_bytes,
                            r2_size_bytes=head_size if head_size is not None else r2_size,
                        ),
                    )
                except Exception as exc:
                    errors += 1
                    method_logger.warning(
                        "Failed to refresh media asset size during reconcile",
                        exc_info=True,
                        extra={"source_object_key": key, "asset_id": str(asset.id)},
                    )
                    MediaLibraryReconcileService._append_item(
                        items,
                        MediaLibraryReconcileItem(
                            action="error",
                            object_key=key,
                            asset_id=asset.id,
                            display_name=display,
                            db_size_bytes=db_size,
                            r2_size_bytes=r2_size,
                            error=str(exc) or "update_failed",
                        ),
                    )
                continue

            matched += 1
            # Omit matched items from the capped sample unless we have room and want quiet report —
            # plan says include ok in action enum; keep them out of the sample to prioritize issues.

        for key, asset in sorted(assets_by_key.items(), key=lambda kv: kv[0]):
            if key in r2_keys:
                continue
            if not MediaLibraryReconcileService._is_source_media_key(
                key, organization_id=organization_id
            ):
                # Unexpected key shape still report as missing if not in R2 listing for media/
                pass
            db_only += 1
            MediaLibraryReconcileService._append_item(
                items,
                MediaLibraryReconcileItem(
                    action="missingInR2",
                    object_key=key,
                    asset_id=asset.id,
                    display_name=asset.display_name or PurePosixPath(key).name,
                    db_size_bytes=asset.source_size_bytes,
                ),
            )

        return MediaLibraryReconcileData(
            dry_run=dry_run,
            r2_scanned=len(r2_objects),
            db_scanned=len(assets_by_key),
            matched=matched,
            r2_only=r2_only,
            db_only=db_only,
            size_refresh=size_refresh,
            created=created,
            updated=updated,
            errors=errors,
            items=items,
        )
