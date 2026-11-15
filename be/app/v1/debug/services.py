from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.common.business_exceptions import AuthorizationError, NotFoundError


class DebugR2MultipartUploadService:
    """Debug-only visibility and cleanup for incomplete R2 multipart uploads."""

    @staticmethod
    def _default_prefix(organization_id: UUID) -> str:
        return f"orgs/{organization_id}/media/"

    @staticmethod
    def _normalize_prefix(organization_id: UUID, prefix: Optional[str]) -> str:
        org_prefix = f"orgs/{organization_id}/"
        clean_prefix = (prefix or "").strip().lstrip("/")
        if not clean_prefix:
            return DebugR2MultipartUploadService._default_prefix(organization_id)
        if not clean_prefix.startswith(org_prefix):
            raise AuthorizationError("Multipart upload prefix is outside this organization")
        return clean_prefix

    @staticmethod
    def _validate_key(organization_id: UUID, key: str) -> str:
        org_prefix = f"orgs/{organization_id}/"
        clean_key = (key or "").strip().lstrip("/")
        if not clean_key:
            raise AuthorizationError("Multipart upload key is required")
        if not clean_key.startswith(org_prefix):
            raise AuthorizationError("Multipart upload key is outside this organization")
        return clean_key

    @staticmethod
    def _upload_item(upload: Dict[str, Any], *, now: datetime, bucket: str) -> Dict[str, Any]:
        initiated_at = upload.get("Initiated")
        if isinstance(initiated_at, datetime):
            if initiated_at.tzinfo is None:
                initiated_at = initiated_at.replace(tzinfo=timezone.utc)
            age_seconds = max(0, int((now - initiated_at).total_seconds()))
            initiated_iso = initiated_at.isoformat()
        else:
            age_seconds = None
            initiated_iso = None

        return {
            "bucket": bucket,
            "key": upload.get("Key"),
            "uploadId": upload.get("UploadId"),
            "initiatedAt": initiated_iso,
            "ageSeconds": age_seconds,
            "storageClass": upload.get("StorageClass"),
            "ownerId": (upload.get("Owner") or {}).get("ID"),
        }

    @staticmethod
    def list_stale_uploads(
        organization_id: UUID,
        *,
        prefix: Optional[str] = None,
        min_age_minutes: int = 120,
        limit: int = 100,
    ) -> Dict[str, Any]:
        from app.common.config import R2_BUCKET_NAME
        from app.v1.media.services import get_r2_client

        if not R2_BUCKET_NAME:
            raise NotFoundError("R2 bucket not configured")

        clean_prefix = DebugR2MultipartUploadService._normalize_prefix(
            organization_id,
            prefix,
        )
        client = get_r2_client()
        now = datetime.now(timezone.utc)
        min_age_seconds = max(0, min_age_minutes) * 60
        uploads: List[Dict[str, Any]] = []
        scanned = 0
        request: Dict[str, Any] = {
            "Bucket": R2_BUCKET_NAME,
            "Prefix": clean_prefix,
            "MaxUploads": min(1000, max(1, limit)),
        }

        while len(uploads) < limit:
            response = client.list_multipart_uploads(**request)
            page_uploads = response.get("Uploads") or []
            if not page_uploads:
                break

            for upload in page_uploads:
                scanned += 1
                item = DebugR2MultipartUploadService._upload_item(
                    upload,
                    now=now,
                    bucket=R2_BUCKET_NAME,
                )
                age_seconds = item.get("ageSeconds")
                if age_seconds is None or age_seconds < min_age_seconds:
                    continue
                uploads.append(item)
                if len(uploads) >= limit:
                    break

            if not response.get("IsTruncated") or len(uploads) >= limit:
                break
            next_key_marker = response.get("NextKeyMarker")
            next_upload_id_marker = response.get("NextUploadIdMarker")
            if not next_key_marker or not next_upload_id_marker:
                break
            request["KeyMarker"] = next_key_marker
            request["UploadIdMarker"] = next_upload_id_marker

        return {
            "bucket": R2_BUCKET_NAME,
            "prefix": clean_prefix,
            "minAgeMinutes": min_age_minutes,
            "scanned": scanned,
            "staleCount": len(uploads),
            "uploads": uploads,
        }

    @staticmethod
    def abort_uploads(
        organization_id: UUID,
        *,
        uploads: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        from botocore.exceptions import ClientError

        from app.common.config import R2_BUCKET_NAME
        from app.v1.media.services import get_r2_client

        if not R2_BUCKET_NAME:
            raise NotFoundError("R2 bucket not configured")

        client = get_r2_client()
        results: List[Dict[str, Any]] = []
        aborted = 0
        error_count = 0
        for upload in uploads:
            key = DebugR2MultipartUploadService._validate_key(
                organization_id,
                upload.get("key", ""),
            )
            upload_id = (upload.get("uploadId") or "").strip()
            if not upload_id:
                raise AuthorizationError("Multipart upload id is required")

            try:
                client.abort_multipart_upload(
                    Bucket=R2_BUCKET_NAME,
                    Key=key,
                    UploadId=upload_id,
                )
                aborted += 1
                results.append(
                    {
                        "key": key,
                        "uploadId": upload_id,
                        "aborted": True,
                        "message": "Aborted",
                    }
                )
            except ClientError as exc:
                error_count += 1
                error_code = str(exc.response.get("Error", {}).get("Code", ""))
                results.append(
                    {
                        "key": key,
                        "uploadId": upload_id,
                        "aborted": False,
                        "message": error_code or str(exc),
                    }
                )

        return {
            "bucket": R2_BUCKET_NAME,
            "requested": len(uploads),
            "aborted": aborted,
            "errorCount": error_count,
            "items": results,
        }
