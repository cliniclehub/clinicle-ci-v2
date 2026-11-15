from __future__ import annotations

import pytest

from conftest import ApiClient, assert_camel_case_response, assert_error_envelope

pytestmark = pytest.mark.api


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/cron-jobs/runs/1", None),
        ("POST", "/api/v1/cron-jobs/runs/prune", {"retentionDays": 30}),
        ("POST", "/api/v1/cron-jobs/runs/1/release", None),
        ("POST", "/api/v1/cron-jobs/jobs/notification-dispatch/run", None),
    ],
)
def test_cron_operation_routes_require_authentication_before_execution(
    api_client: ApiClient, method: str, path: str, body: dict | None
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(method, path, expected_status=401, **kwargs)
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize("retention_days", [-1, 3651])
def test_cron_prune_rejects_invalid_retention(
    api_client: ApiClient, org_admin_token: str, retention_days: int
):
    payload = api_client.request(
        "POST", "/api/v1/cron-jobs/runs/prune", token=org_admin_token,
        json_body={"retentionDays": retention_days}, expected_status=422
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)

