"""Unit tests for MultipartUploadService pure helper methods."""

import re
from unittest.mock import patch
from uuid import uuid4

from app.v1.media.services import MultipartUploadService


def test_generate_object_key_private_has_media_prefix():
    org_id = uuid4()
    key = MultipartUploadService.generate_object_key(org_id, "video.mp4", is_public=False)
    assert key.startswith(f"orgs/{org_id}/media/")


def test_generate_object_key_public_image_prefix():
    org_id = uuid4()
    key = MultipartUploadService.generate_object_key(org_id, "thumb.jpg", is_public=True)
    assert key.startswith(f"orgs/{org_id}/public/images/")


def test_generate_object_key_public_logo_prefix():
    org_id = uuid4()
    key = MultipartUploadService.generate_object_key(org_id, "logo.png", is_public=True, content_type="logo")
    assert key.startswith(f"orgs/{org_id}/public/logos/")


def test_generate_object_key_sanitizes_special_chars():
    org_id = uuid4()
    key = MultipartUploadService.generate_object_key(org_id, "my file (1).mp4", is_public=False)
    sanitized_part = key.split("/")[-1]
    assert " " not in sanitized_part
    assert "(" not in sanitized_part
    assert ")" not in sanitized_part


def test_generate_object_key_timestamp_prefix():
    org_id = uuid4()
    key = MultipartUploadService.generate_object_key(org_id, "file.mp4", is_public=False)
    filename_part = key.split("/")[-1]
    timestamp_str = filename_part.split("-")[0]
    assert timestamp_str.isdigit()


def test_get_bucket_and_worker_public_raises_without_config():
    with (
        patch("app.v1.media.services.R2_PUBLIC_BUCKET_NAME", None),
        patch("app.v1.media.services.R2_BUCKET_NAME", None),
        patch("app.v1.media.services.R2_PUBLIC_WORKER_URL", None),
        patch("app.v1.media.services.R2_WORKER_URL", None),
    ):
        from app.common.business_exceptions import ValidationError
        import pytest
        with pytest.raises(ValidationError):
            MultipartUploadService.get_bucket_and_worker(is_public=True)


def test_get_bucket_and_worker_private_returns_private_bucket():
    with (
        patch("app.v1.media.services.R2_BUCKET_NAME", "private-bucket"),
        patch("app.v1.media.services.R2_WORKER_URL", "https://worker.example.com"),
    ):
        bucket, worker = MultipartUploadService.get_bucket_and_worker(is_public=False)
        assert bucket == "private-bucket"
        assert worker == "https://worker.example.com"
