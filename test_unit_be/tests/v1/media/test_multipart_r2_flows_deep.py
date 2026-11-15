"""MultipartUploadService R2 flows with fully mocked boto client."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError

from app.common.business_exceptions import ValidationError
from app.v1.media.services import MultipartUploadService, get_r2_client


def _run(coro):
    return asyncio.run(coro)


def _client_error(code="NoSuchKey"):
    return ClientError({"Error": {"Code": code, "Message": "boom"}}, "op")


def _silent_logger():
    ml = MagicMock()
    return MagicMock(get_method_logger=MagicMock(return_value=ml))


def test_get_r2_client_builds_when_configured():
    fake = MagicMock()
    with (
        patch("app.v1.media.services.CLOUDFLARE_ACCOUNT_ID", "acct"),
        patch("app.v1.media.services.R2_ACCESS_KEY_ID", "key"),
        patch("app.v1.media.services.R2_SECRET_ACCESS_KEY", "secret"),
        patch("app.v1.media.services.boto3.client", return_value=fake) as client_ctor,
    ):
        assert get_r2_client() is fake
        assert client_ctor.called


def test_initiate_presign_complete_abort_delete_happy_and_errors():
    oid = uuid4()
    key = f"orgs/{oid}/media/file.bin"
    client = MagicMock()
    client.create_multipart_upload.return_value = {"UploadId": "up-1"}
    client.generate_presigned_url.return_value = "https://signed.example/part"
    client.complete_multipart_upload.return_value = {"ETag": '"etag-1"'}
    client.head_object.return_value = {
        "ContentLength": 42,
        "ContentType": "application/pdf",
    }

    with (
        patch("app.v1.media.services.R2_BUCKET_NAME", "priv"),
        patch("app.v1.media.services.R2_WORKER_URL", "https://worker"),
        patch("app.v1.media.services.get_r2_client", return_value=client),
        patch("app.v1.media.services.logger", _silent_logger()),
    ):
        init = _run(
            MultipartUploadService.initiate_multipart_upload(
                oid,
                "file.bin",
                "application/octet-stream",
                file_size=20 * 1024 * 1024,
                object_key=key,
            )
        )
        assert init["upload_id"] == "up-1"
        assert init["key"] == key
        assert init["total_parts"] >= 1

        huge = _run(
            MultipartUploadService.initiate_multipart_upload(
                oid,
                "huge.bin",
                "application/octet-stream",
                file_size=11 * 1024 * 1024 * 10000,
                object_key=key,
            )
        )
        assert huge["total_parts"] <= 10000

        part = _run(
            MultipartUploadService.get_presigned_url_for_part("up-1", key, 1)
        )
        assert part["part_number"] == 1
        assert "signed" in part["presigned_url"]

        done = _run(
            MultipartUploadService.complete_multipart_upload(
                "up-1",
                key,
                [{"part_number": 1, "etag": "e1"}],
            )
        )
        assert done["size"] == 42
        assert done["etag"] == "etag-1"
        assert done["url"].startswith("https://worker/")

        aborted = _run(MultipartUploadService.abort_multipart_upload("up-1", key))
        assert aborted["success"] is True

        deleted = _run(MultipartUploadService.delete_object(key))
        assert deleted["success"] is True

        client.create_multipart_upload.side_effect = _client_error()
        with pytest.raises(ValidationError):
            _run(
                MultipartUploadService.initiate_multipart_upload(
                    oid, "f.bin", "text/plain", 10, object_key=key
                )
            )

        client.generate_presigned_url.side_effect = _client_error()
        with pytest.raises(ValidationError):
            _run(MultipartUploadService.get_presigned_url_for_part("up-1", key, 2))

        client.complete_multipart_upload.side_effect = _client_error()
        with pytest.raises(ValidationError):
            _run(
                MultipartUploadService.complete_multipart_upload(
                    "up-1", key, [{"part_number": 1, "etag": "e"}]
                )
            )

        client.abort_multipart_upload.side_effect = _client_error()
        soft = _run(MultipartUploadService.abort_multipart_upload("up-1", key))
        assert soft["success"] is False

        with pytest.raises(ValidationError):
            _run(MultipartUploadService.delete_object("  "))

        client.delete_object.side_effect = _client_error()
        with pytest.raises(ValidationError):
            _run(MultipartUploadService.delete_object(key))


def test_get_bucket_and_worker_missing_worker():
    with (
        patch("app.v1.media.services.R2_BUCKET_NAME", "priv"),
        patch("app.v1.media.services.R2_WORKER_URL", None),
        patch("app.v1.media.services.R2_PUBLIC_WORKER_URL", None),
        pytest.raises(ValidationError),
    ):
        MultipartUploadService.get_bucket_and_worker(False)
