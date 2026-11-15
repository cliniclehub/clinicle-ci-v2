from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_error_envelope


pytestmark = pytest.mark.api


RESOURCE_ID = "00000000-0000-0000-0000-000000000001"
PRIVATE_KEY = f"orgs/{RESOURCE_ID}/media/contract.txt"


PROTECTED_MEDIA_ROUTES = [
    ("POST", "/api/v1/media/sign-access", {"objectKey": PRIVATE_KEY}),
    ("POST", "/api/v1/media/assets", {"sourceObjectKey": PRIVATE_KEY, "mediaType": "document"}),
    ("GET", "/api/v1/media/assets?limit=1", None),
    ("POST", "/api/v1/media/assets/reconcile?dryRun=true", None),
    ("GET", f"/api/v1/media/assets/{RESOURCE_ID}", None),
    ("DELETE", f"/api/v1/media/assets/{RESOURCE_ID}", None),
    ("PATCH", f"/api/v1/media/assets/{RESOURCE_ID}/rename", {"fileName": "renamed.txt"}),
    (
        "POST",
        "/api/v1/media/multipart/initiate/",
        {"fileName": "contract.txt", "fileType": "text/plain", "fileSize": 1},
    ),
    (
        "POST",
        "/api/v1/media/multipart/presigned-url/",
        {"uploadId": "contract", "key": PRIVATE_KEY, "partNumber": 1},
    ),
    (
        "POST",
        f"/api/v1/media/multipart/presigned-urls/batch/?upload_id=contract&key={PRIVATE_KEY}&part_numbers=1",
        None,
    ),
    (
        "POST",
        "/api/v1/media/multipart/complete/",
        {"uploadId": "contract", "key": PRIVATE_KEY, "parts": [{"partNumber": 1, "etag": "contract"}]},
    ),
    ("POST", "/api/v1/media/multipart/abort/", {"uploadId": "contract", "key": PRIVATE_KEY}),
]


@pytest.mark.parametrize(("method", "path", "body"), PROTECTED_MEDIA_ROUTES)
def test_media_routes_require_authentication(
    api_client: ApiClient,
    org_domain: str,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        org_domain=org_domain,
        expected_status=401,
        **kwargs,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/media/assets?limit=0", None),
        ("GET", "/api/v1/media/assets?limit=501", None),
        ("PATCH", f"/api/v1/media/assets/{RESOURCE_ID}/rename", {"fileName": ""}),
        ("POST", "/api/v1/media/multipart/presigned-url/", {"uploadId": "contract", "key": PRIVATE_KEY, "partNumber": 0}),
    ],
)
def test_media_routes_reject_invalid_contract_values(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(org_admin_role),
        expected_status=422,
        **kwargs,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)
