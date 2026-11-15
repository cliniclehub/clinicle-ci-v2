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


def test_media_asset_list_returns_camel_case(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    payload = api_client.request("GET", "/api/v1/media/assets?limit=10", token=token)
    assert_success_envelope(payload)
    assert_camel_case_response(payload)


def test_media_reads_reject_user_role(api_client: ApiClient, user_role: ApiRole):
    token = api_client.access_token(user_role)

    payload = api_client.request(
        "GET",
        "/api/v1/media/assets?limit=10",
        token=token,
        expected_status=403,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)
