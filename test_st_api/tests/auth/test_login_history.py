from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def test_me_login_history_returns_recent_login_activity(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    payload = api_client.request(
        "GET",
        "/api/v1/auth/me/login-history?days=30&include_failed=false",
        token=token,
    )

    assert_success_envelope(payload)
    assert payload["data"]["periodDays"] == 30
    assert payload["data"]["total"] >= 1
    assert isinstance(payload["data"]["loginHistory"], list)
    assert_camel_case_response(payload)


def test_me_login_statistics_returns_counts_for_current_user(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    payload = api_client.request(
        "GET",
        "/api/v1/auth/me/login-statistics?days=30",
        token=token,
    )

    assert_success_envelope(payload)
    assert payload["data"]["periodDays"] == 30
    assert payload["data"]["successfulLogins"] >= 1
    assert_camel_case_response(payload)
