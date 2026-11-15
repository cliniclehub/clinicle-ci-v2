"""MultipartUploadService validation / key helpers (no live R2)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import AuthorizationError, ValidationError
from app.v1.media.services import MultipartUploadService, get_r2_client


def test_get_r2_client_requires_credentials():
    with (
        patch("app.v1.media.services.CLOUDFLARE_ACCOUNT_ID", None),
        patch("app.v1.media.services.R2_ACCESS_KEY_ID", None),
        patch("app.v1.media.services.R2_SECRET_ACCESS_KEY", None),
        pytest.raises(ValidationError),
    ):
        get_r2_client()


def test_validate_object_key_for_org_paths():
    oid = uuid4()
    ok = MultipartUploadService.validate_object_key_for_org(
        oid, f"orgs/{oid}/media/file.mp4", is_public=False
    )
    assert ok.endswith("media/file.mp4")

    pub = MultipartUploadService.validate_object_key_for_org(
        oid, f"orgs/{oid}/public/logos/logo.png", is_public=True
    )
    assert "public/logos" in pub

    with pytest.raises(ValidationError):
        MultipartUploadService.validate_object_key_for_org(oid, "", is_public=False)
    with pytest.raises(ValidationError):
        MultipartUploadService.validate_object_key_for_org(
            oid, f"orgs/{oid}/../media/x", is_public=False
        )
    with pytest.raises(AuthorizationError):
        MultipartUploadService.validate_object_key_for_org(
            oid, f"orgs/{uuid4()}/media/x", is_public=False
        )
    with pytest.raises(AuthorizationError):
        MultipartUploadService.validate_object_key_for_org(
            oid, f"orgs/{oid}/other/x", is_public=False
        )


def test_get_bucket_and_worker_and_generate_key():
    with (
        patch("app.v1.media.services.R2_BUCKET_NAME", "priv"),
        patch("app.v1.media.services.R2_WORKER_URL", "https://priv.worker"),
        patch("app.v1.media.services.R2_PUBLIC_BUCKET_NAME", "pub"),
        patch("app.v1.media.services.R2_PUBLIC_WORKER_URL", "https://pub.worker"),
    ):
        b, w = MultipartUploadService.get_bucket_and_worker(False)
        assert b == "priv" and "priv" in w
        b2, w2 = MultipartUploadService.get_bucket_and_worker(True)
        assert b2 == "pub"

    oid = uuid4()
    key = MultipartUploadService.generate_object_key(oid, "My File!.mp4", is_public=False)
    assert key.startswith(f"orgs/{oid}/media/")
    assert key.endswith(".mp4")

    key2 = MultipartUploadService.generate_object_key(
        oid, "logo.png", is_public=True, content_type="logo"
    )
    assert "/public/logos/" in key2
