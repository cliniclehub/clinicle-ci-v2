from __future__ import annotations

import pytest

from conftest import (
    ApiClient,
    assert_camel_case_response,
    assert_error_envelope,
    role_by_slug,
)


pytestmark = pytest.mark.api
RESOURCE_ID = "00000000-0000-0000-0000-000000000001"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/users/org", None),
        ("GET", "/api/v1/cron-jobs/settings", None),
        ("GET", "/api/v1/email-engine/queue", None),
        ("GET", "/api/v1/email-templates/", None),
        ("GET", "/api/v1/media/assets", None),
        ("GET", "/api/v1/notifications/org-settings", None),
        ("POST", "/api/v1/cron-jobs/jobs/notification-dispatch/run", None),
    ],
)
def test_user_cannot_access_administration_routes(
    api_client: ApiClient,
    method: str,
    path: str,
    body: dict | None,
):
    role = role_by_slug("user")
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(role),
        expected_status=403,
        **kwargs,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_org_admin_cannot_run_platform_cron_operations(
    api_client: ApiClient,
    org_admin_token: str,
):
    payload = api_client.request(
        "POST",
        "/api/v1/cron-jobs/jobs/notification-dispatch/run",
        token=org_admin_token,
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_platform_super_admin_is_not_an_implicit_org_user_manager(api_client: ApiClient):
    role = role_by_slug("super-admin")
    payload = api_client.request(
        "GET",
        f"/api/v1/users/org/{RESOURCE_ID}",
        token=api_client.access_token(role),
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
