from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def test_my_organization_read_and_reversible_city_patch(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    org_domain: str,
):
    """Typical-org baseline: org admin reads and updates Test Org A settings."""
    token = api_client.access_token(org_admin_role)

    read_payload = api_client.request(
        "GET",
        "/api/v1/organizations/my-organization",
        token=token,
    )
    assert_success_envelope(read_payload)
    assert_camel_case_response(read_payload)
    org = read_payload["data"]
    assert org["domain"] == org_domain
    assert "Test Org A" in org["name"] or org["domain"].startswith("testorg-a")

    original_city = org.get("city")
    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    patched_city = f"ST-City-{stamp}"

    try:
        patch_payload = api_client.request(
            "PATCH",
            "/api/v1/organizations/my-organization",
            token=token,
            json_body={"city": patched_city},
        )
        assert_success_envelope(patch_payload)
        assert patch_payload["data"]["city"] == patched_city
        assert_camel_case_response(patch_payload)
    finally:
        api_client.request(
            "PATCH",
            "/api/v1/organizations/my-organization",
            token=token,
            json_body={"city": original_city},
        )
