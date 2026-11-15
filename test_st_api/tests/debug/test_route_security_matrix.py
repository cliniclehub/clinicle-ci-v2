from __future__ import annotations

import pytest

from conftest import ApiClient, assert_camel_case_response, assert_error_envelope

pytestmark = pytest.mark.api


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/debug/ping", None),
        ("GET", "/api/v1/debug/media/multipart-uploads", None),
        ("POST", "/api/v1/debug/media/multipart-uploads/abort", {"uploads": []}),
    ],
)
def test_debug_routes_require_authentication(
    api_client: ApiClient, method: str, path: str, body: dict | None
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(method, path, expected_status=401, **kwargs)
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_org_admin_can_use_debug_ping(api_client: ApiClient, org_admin_token: str):
    payload = api_client.request(
        "GET", "/api/v1/debug/ping", token=org_admin_token, expected_status=200
    )
    assert payload["status"] == "success"
    assert payload["data"]["ok"] is True
    assert payload["data"]["organizationId"]
    assert_camel_case_response(payload)
