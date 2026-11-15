from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_error_envelope, assert_success_envelope

pytestmark = pytest.mark.api


def test_user_reads_notification_preferences(api_client: ApiClient, user_role: ApiRole):
    payload = api_client.request(
        "GET", "/api/v1/notifications/preferences/me", token=api_client.access_token(user_role)
    )
    assert_success_envelope(payload)
    assert_camel_case_response(payload)


def test_no_01_authenticated_user_reads_notification_rule_vocabulary(
    api_client: ApiClient, user_role: ApiRole
):
    payload = api_client.request(
        "GET", "/api/v1/notifications/rules", token=api_client.access_token(user_role)
    )
    assert_success_envelope(payload)
    assert isinstance(payload["data"], list)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/notifications/org-settings",
        "/api/v1/notifications/effective-settings",
        "/api/v1/notifications/schedules",
        "/api/v1/notifications/deliveries",
    ],
)
def test_no_10_user_cannot_read_notification_administration(
    api_client: ApiClient, user_role: ApiRole, path: str
):
    payload = api_client.request(
        "GET", path, token=api_client.access_token(user_role), expected_status=403
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize("path", ["/api/v1/notifications/schedules?pageSize=101", "/api/v1/notifications/deliveries?page=0"])
def test_no_10_notification_reports_reject_invalid_pagination(
    api_client: ApiClient, org_admin_role: ApiRole, path: str
):
    payload = api_client.request(
        "GET", path, token=api_client.access_token(org_admin_role), expected_status=422
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
