import math
from typing import List, Optional
from urllib.parse import unquote
from uuid import UUID
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.common.app_logger import get_logger
from app.common.business_exceptions import AuthorizationError, NotFoundError, ValidationError
from app.common.config import (
    CLOUDFLARE_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_PUBLIC_BUCKET_NAME,
    R2_MEDIA_SERVER_WORKER_URL as R2_WORKER_URL,
    R2_PUBLIC_MEDIA_SERVER_WORKER_URL as R2_PUBLIC_WORKER_URL,
)

logger = get_logger(__name__)

# Chunk size: 10MB (minimum for R2 multipart is 5MB, except last part)
DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024  # 10MB
MIN_CHUNK_SIZE = 5 * 1024 * 1024  # 5MB minimum for R2

# Presigned URL expiration: 1 hour
PRESIGNED_URL_EXPIRATION = 3600


def get_r2_client():
    """Create and return an R2 S3-compatible client"""
    if not all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY]):
        raise ValidationError("R2 credentials not configured")
    
    return boto3.client(
        's3',
        endpoint_url=f"https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(
            signature_version='s3v4',
            s3={'addressing_style': 'path'}
        ),
        region_name='auto'
    )


class MultipartUploadService:
    """Service for handling multipart uploads to Cloudflare R2"""

    @staticmethod
    def validate_object_key_for_org(
        org_id: UUID,
        object_key: str,
        *,
        is_public: bool,
        content_type: Optional[str] = None,
    ) -> str:
        """Ensure upload keys stay under the caller org and allowed media prefixes."""
        key = unquote((object_key or "").strip()).lstrip("/")
        if not key or ".." in key.split("/"):
            raise ValidationError("Invalid object key")

        expected_prefix = f"orgs/{org_id}/"
        if not key.startswith(expected_prefix):
            raise AuthorizationError("Object key is outside your organization")

        remainder = key[len(expected_prefix) :]
        if is_public:
            allowed = remainder.startswith("public/logos/") or remainder.startswith(
                "public/images/"
            )
        else:
            allowed = remainder.startswith("media/")

        if not allowed:
            raise AuthorizationError("Object key prefix is not allowed for this upload")

        return key
    
    @staticmethod
    def get_bucket_and_worker(is_public: bool) -> tuple[str, str]:
        """Get the appropriate bucket and worker URL based on public/private"""
        if is_public:
            bucket = R2_PUBLIC_BUCKET_NAME or R2_BUCKET_NAME
            worker_url = R2_PUBLIC_WORKER_URL or R2_WORKER_URL
        else:
            bucket = R2_BUCKET_NAME
            worker_url = R2_WORKER_URL
        
        if not bucket:
            raise ValidationError("R2 bucket not configured")
        if not worker_url:
            raise ValidationError("R2 worker URL not configured")
            
        return bucket, worker_url
    
    @staticmethod
    def generate_object_key(
        org_id: UUID,
        file_name: str,
        is_public: bool,
        content_type: Optional[str] = None
    ) -> str:
        """Generate the object key for R2 storage"""
        import time
        import re
        
        # Sanitize filename
        safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', file_name)
        timestamp = int(time.time() * 1000)
        
        # Determine path prefix based on content type
        if is_public:
            if content_type in ['logo', 'favicon']:
                prefix = f"orgs/{org_id}/public/logos"
            else:
                prefix = f"orgs/{org_id}/public/images"
        else:
            prefix = f"orgs/{org_id}/media"
        
        return f"{prefix}/{timestamp}-{safe_name}"
    
    @staticmethod
    async def initiate_multipart_upload(
        org_id: UUID,
        file_name: str,
        file_type: str,
        file_size: int,
        is_public: bool = False,
        content_type: Optional[str] = None,
        object_key: Optional[str] = None,
    ) -> dict:
        """
        Initiate a multipart upload to R2
        
        Returns:
            dict with upload_id, key, bucket, chunk_size, total_parts
        """
        method_logger = logger.get_method_logger("initiate_multipart_upload")
        
        try:
            bucket, worker_url = MultipartUploadService.get_bucket_and_worker(is_public)
            key = object_key or MultipartUploadService.generate_object_key(
                org_id, file_name, is_public, content_type
            )
            key = MultipartUploadService.validate_object_key_for_org(
                org_id, key, is_public=is_public, content_type=content_type
            )
            
            method_logger.info("Initiating multipart upload", {
                "bucket": bucket,
                "key": key,
                "file_size": file_size,
                "file_type": file_type
            })
            
            client = get_r2_client()
            
            response = client.create_multipart_upload(
                Bucket=bucket,
                Key=key,
                ContentType=file_type,
                Metadata={
                    'original-name': file_name,
                    'org-id': str(org_id),
                    'is-public': str(is_public).lower(),
                    'content-type-category': content_type or 'media'
                }
            )
            
            upload_id = response['UploadId']
            
            # Calculate chunk size and total parts
            chunk_size = DEFAULT_CHUNK_SIZE
            total_parts = math.ceil(file_size / chunk_size)
            
            # Ensure we don't exceed R2's 10,000 part limit
            if total_parts > 10000:
                chunk_size = math.ceil(file_size / 10000)
                total_parts = math.ceil(file_size / chunk_size)
            
            method_logger.info("Multipart upload initiated", {
                "upload_id": upload_id,
                "key": key,
                "total_parts": total_parts,
                "chunk_size": chunk_size
            })
            
            return {
                "upload_id": upload_id,
                "key": key,
                "bucket": bucket,
                "chunk_size": chunk_size,
                "total_parts": total_parts
            }
            
        except ClientError as e:
            method_logger.error("Failed to initiate multipart upload", e, {
                "file_name": file_name,
                "file_size": file_size
            })
            raise ValidationError(f"Failed to initiate upload: {str(e)}")
    
    @staticmethod
    async def get_presigned_url_for_part(
        upload_id: str,
        key: str,
        part_number: int,
        is_public: bool = False
    ) -> dict:
        """
        Generate a presigned URL for uploading a specific part
        
        Returns:
            dict with presigned_url, part_number, expires_in
        """
        method_logger = logger.get_method_logger("get_presigned_url_for_part")
        
        try:
            bucket, _ = MultipartUploadService.get_bucket_and_worker(is_public)
            client = get_r2_client()
            
            presigned_url = client.generate_presigned_url(
                'upload_part',
                Params={
                    'Bucket': bucket,
                    'Key': key,
                    'UploadId': upload_id,
                    'PartNumber': part_number
                },
                ExpiresIn=PRESIGNED_URL_EXPIRATION
            )
            
            method_logger.debug("Generated presigned URL", {
                "key": key,
                "part_number": part_number,
                "expires_in": PRESIGNED_URL_EXPIRATION
            })
            
            return {
                "presigned_url": presigned_url,
                "part_number": part_number,
                "expires_in": PRESIGNED_URL_EXPIRATION
            }
            
        except ClientError as e:
            method_logger.error("Failed to generate presigned URL", e, {
                "key": key,
                "part_number": part_number
            })
            raise ValidationError(f"Failed to generate presigned URL: {str(e)}")
    
    @staticmethod
    async def complete_multipart_upload(
        upload_id: str,
        key: str,
        parts: List[dict],
        is_public: bool = False,
        metadata: Optional[dict] = None
    ) -> dict:
        """
        Complete a multipart upload
        
        Args:
            upload_id: The multipart upload ID
            key: The object key
            parts: List of {'part_number': int, 'etag': str}
            is_public: Whether the file is in the public bucket
            metadata: Additional metadata (not used in completion, stored during initiate)
        
        Returns:
            dict with key, url, size, etag
        """
        method_logger = logger.get_method_logger("complete_multipart_upload")
        
        try:
            bucket, worker_url = MultipartUploadService.get_bucket_and_worker(is_public)
            client = get_r2_client()
            
            # Format parts for R2
            formatted_parts = [
                {
                    'PartNumber': p['part_number'],
                    'ETag': p['etag']
                }
                for p in sorted(parts, key=lambda x: x['part_number'])
            ]
            
            method_logger.info("Completing multipart upload", {
                "upload_id": upload_id,
                "key": key,
                "num_parts": len(formatted_parts)
            })
            
            response = client.complete_multipart_upload(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={'Parts': formatted_parts}
            )
            
            # Get the object size
            head_response = client.head_object(Bucket=bucket, Key=key)
            file_size = head_response.get('ContentLength', 0)
            
            # Build the URL
            file_url = f"{worker_url}/{key}"
            
            method_logger.info("Multipart upload completed", {
                "key": key,
                "url": file_url,
                "size": file_size,
                "etag": response.get('ETag', '')
            })
            
            return {
                "key": key,
                "url": file_url,
                "size": file_size,
                "etag": response.get('ETag', '').strip('"'),
                "mimetype": head_response.get('ContentType') or "application/octet-stream",
            }
            
        except ClientError as e:
            method_logger.error("Failed to complete multipart upload", e, {
                "upload_id": upload_id,
                "key": key
            })
            raise ValidationError(f"Failed to complete upload: {str(e)}")
    
    @staticmethod
    async def abort_multipart_upload(
        upload_id: str,
        key: str,
        is_public: bool = False
    ) -> dict:
        """
        Abort a multipart upload
        
        Returns:
            dict with success and message
        """
        method_logger = logger.get_method_logger("abort_multipart_upload")
        
        try:
            bucket, _ = MultipartUploadService.get_bucket_and_worker(is_public)
            client = get_r2_client()
            
            client.abort_multipart_upload(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id
            )
            
            method_logger.info("Multipart upload aborted", {
                "upload_id": upload_id,
                "key": key
            })
            
            return {
                "success": True,
                "message": "Upload aborted successfully"
            }
            
        except ClientError as e:
            method_logger.error("Failed to abort multipart upload", e, {
                "upload_id": upload_id,
                "key": key
            })
            # Return success even if abort fails (upload may have already been completed or aborted)
            return {
                "success": False,
                "message": f"Failed to abort upload: {str(e)}"
            }

    @staticmethod
    async def delete_object(
        key: str,
        is_public: bool = False,
    ) -> dict:
        """
        Delete a completed object from R2.

        Returns:
            dict with success and key
        """
        method_logger = logger.get_method_logger("delete_object")

        key = (key or "").strip()
        if not key:
            raise ValidationError("Object key is required")

        try:
            bucket, _ = MultipartUploadService.get_bucket_and_worker(is_public)
            client = get_r2_client()

            client.delete_object(Bucket=bucket, Key=key)

            method_logger.info("Object deleted from R2", {"key": key, "bucket": bucket})

            return {"success": True, "key": key}

        except ClientError as e:
            method_logger.error("Failed to delete object from R2", e, {"key": key})
            raise ValidationError(f"Failed to delete file from storage: {str(e)}")
