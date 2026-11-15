"""Tests for multipart upload object-key validation."""

from uuid import UUID

import pytest

from app.common.business_exceptions import AuthorizationError
from app.v1.media.services import MultipartUploadService

ORG_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_ORG = UUID("22222222-2222-4222-8222-222222222222")


def test_validate_object_key_for_org_private_media_prefix():
    key = f"orgs/{ORG_ID}/media/123-file.mp4"
    assert (
        MultipartUploadService.validate_object_key_for_org(ORG_ID, key, is_public=False)
        == key
    )


def test_validate_object_key_for_org_public_image_prefix():
    key = f"orgs/{ORG_ID}/public/images/card.jpg"
    assert (
        MultipartUploadService.validate_object_key_for_org(ORG_ID, key, is_public=True)
        == key
    )


def test_validate_object_key_for_org_rejects_cross_org_prefix():
    key = f"orgs/{OTHER_ORG}/media/evil.mp4"
    with pytest.raises(AuthorizationError):
        MultipartUploadService.validate_object_key_for_org(ORG_ID, key, is_public=False)

def test_validate_object_key_for_org_rejects_unknown_private_prefix():
    key = f"orgs/{ORG_ID}/unknown/sub/file.mp4"
    with pytest.raises(AuthorizationError):
        MultipartUploadService.validate_object_key_for_org(ORG_ID, key, is_public=False)
