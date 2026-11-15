from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def test_users_me_returns_current_user_profile(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    payload = api_client.request("GET", "/api/v1/users/me", token=token)

    assert_success_envelope(payload)
    assert payload["data"]["email"] == org_admin_role.email
    assert_camel_case_response(payload)
