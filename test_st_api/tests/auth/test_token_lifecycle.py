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


def test_refresh_returns_new_access_token_for_fresh_login(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    login_payload = api_client.login(org_admin_role)
    refresh_token = login_payload["data"]["tokens"]["refreshToken"]

    payload = api_client.request(
        "POST",
        "/api/v1/auth/refresh",
        json_body={"refreshToken": refresh_token},
    )

    assert_success_envelope(payload)
    assert payload["data"]["accessToken"]
    assert payload["data"]["refreshToken"] == refresh_token
    assert_camel_case_response(payload)


def test_logout_revokes_refresh_token_from_fresh_login(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    login_payload = api_client.login(org_admin_role)
    refresh_token = login_payload["data"]["tokens"]["refreshToken"]

    logout_payload = api_client.request(
        "POST",
        "/api/v1/auth/logout",
        json_body={"refreshToken": refresh_token},
    )
    assert_success_envelope(logout_payload)
    assert logout_payload["data"]["loggedOut"] is True
    assert_camel_case_response(logout_payload)

    refresh_payload = api_client.request(
        "POST",
        "/api/v1/auth/refresh",
        json_body={"refreshToken": refresh_token},
        expected_status=401,
    )
    assert_error_envelope(refresh_payload)
    assert_camel_case_response(refresh_payload)

