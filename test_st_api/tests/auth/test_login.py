from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def test_login_returns_success_envelope_user_and_tokens_for_each_e2e_user(
    api_client: ApiClient,
    api_role: ApiRole,
):
    payload = api_client.login(api_role)

    assert_success_envelope(payload)
    assert payload["data"]["user"]["email"] == api_role.email
    assert payload["data"]["tokens"]["accessToken"]
    assert_camel_case_response(payload)
