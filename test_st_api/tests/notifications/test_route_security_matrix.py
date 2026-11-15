from __future__ import annotations

import pytest

from conftest import ApiClient, assert_camel_case_response, assert_error_envelope

pytestmark = pytest.mark.api
RESOURCE_ID = "00000000-0000-0000-0000-000000000001"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/notifications/rules", None),
        ("GET", "/api/v1/notifications/org-settings", None),
        ("PATCH", "/api/v1/notifications/org-settings", {}),
        ("GET", "/api/v1/notifications/effective-settings", None),
        ("GET", "/api/v1/notifications/schedules", None),
        ("GET", "/api/v1/notifications/deliveries", None),
        ("GET", "/api/v1/notifications/preferences/me", None),
        ("PATCH", "/api/v1/notifications/preferences/me", {}),
        ("POST", "/api/v1/notifications/dispatch-due?limit=1", None),
    ],
)
def test_notification_administration_routes_require_authentication(
    api_client: ApiClient, org_domain: str, method: str, path: str, body: dict | None
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(method, path, org_domain=org_domain, expected_status=401, **kwargs)
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize("limit", [0, 501])
def test_notification_dispatch_rejects_invalid_batch_limit(
    api_client: ApiClient, org_admin_token: str, limit: int
):
    payload = api_client.request(
        "POST", f"/api/v1/notifications/dispatch-due?limit={limit}",
        token=org_admin_token, expected_status=422
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
