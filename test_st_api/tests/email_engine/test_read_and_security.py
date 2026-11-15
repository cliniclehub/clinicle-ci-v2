from __future__ import annotations

import pytest

from conftest import (
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
)


pytestmark = pytest.mark.api


def test_email_engine_queue_logs_and_analytics_are_readable_by_org_admin(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    for path in (
        "/api/v1/email-engine/queue?limit=5",
        "/api/v1/email-engine/logs?limit=5",
        "/api/v1/email-engine/analytics",
    ):
        payload = api_client.request("GET", path, token=token)

        assert_success_envelope(payload)
        assert_camel_case_response(payload)


def test_email_engine_queue_rejects_user_role(
    api_client: ApiClient,
    user_role: ApiRole,
):
    token = api_client.access_token(user_role)

    payload = api_client.request(
        "GET",
        "/api/v1/email-engine/queue?limit=1",
        token=token,
        expected_status=403,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)
