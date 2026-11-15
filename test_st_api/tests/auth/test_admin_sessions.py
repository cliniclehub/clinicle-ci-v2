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


def test_admin_sessions_allows_org_admin_for_same_org_user(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    user_role: ApiRole,
):
    admin_token = api_client.access_token(org_admin_role)
    user_payload = api_client.login(user_role)
    user_id = user_payload["data"]["user"]["id"]

    payload = api_client.request(
        "GET",
        f"/api/v1/auth/admin/sessions/{user_id}",
        token=admin_token,
    )

    assert_success_envelope(payload)
    assert isinstance(payload["data"]["sessions"], list)
    assert payload["data"]["total"] >= 1
    assert_camel_case_response(payload)


def test_admin_sessions_rejects_user_role(
    api_client: ApiClient,
    user_role: ApiRole,
):
    user_token = api_client.access_token(user_role)
    user_id = api_client.login(user_role)["data"]["user"]["id"]

    payload = api_client.request(
        "GET",
        f"/api/v1/auth/admin/sessions/{user_id}",
        token=user_token,
        expected_status=403,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)
