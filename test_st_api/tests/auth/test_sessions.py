from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def test_me_sessions_returns_current_user_sessions_without_raw_tokens(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    payload = api_client.request("GET", "/api/v1/auth/me/sessions", token=token)

    assert_success_envelope(payload)
    assert payload["data"]["total"] >= 1
    assert isinstance(payload["data"]["sessions"], list)
    serialized = str(payload["data"]["sessions"]).lower()
    assert "accessToken" not in serialized
    assert "refreshToken" not in serialized
    assert "password" not in serialized
    assert_camel_case_response(payload)

