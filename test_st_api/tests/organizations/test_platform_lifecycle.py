from __future__ import annotations

from uuid import uuid4

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_error_envelope, assert_success_envelope


pytestmark = pytest.mark.api


def test_platform_admin_organization_lifecycle_reconciles_admin_and_public_surfaces(
    api_client: ApiClient,
    super_admin_role: ApiRole,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(super_admin_role)
    marker = uuid4().hex
    domain = f"api-org-{marker}.invalid"
    name = f"API Organization {marker}"
    organization_id: str | None = None
    deleted = False
    try:
        created = api_client.request(
            "POST",
            "/api/v1/organizations/",
            json_body={
                "name": name,
                "domain": domain,
                "timezone": "UTC",
                "isActive": True,
                "supportEmail": f"support-{marker}@example.invalid",
                "siteTheme": {"brandMarker": marker},
            },
            token=token,
        )
        assert_success_envelope(created)
        organization_id = created["data"]["id"]
        assert created["data"]["domain"] == domain
        assert created["data"]["timezone"] == "UTC"

        fetched = api_client.request(
            "GET", f"/api/v1/organizations/{organization_id}", token=token
        )
        assert fetched["data"]["id"] == organization_id

        updated = api_client.request(
            "PATCH",
            f"/api/v1/organizations/{organization_id}",
            json_body={"city": "Lifecycle City", "timezone": "America/Chicago"},
            token=token,
        )
        assert updated["data"]["city"] == "Lifecycle City"
        assert updated["data"]["timezone"] == "America/Chicago"

        listed = api_client.request(
            "GET",
            f"/api/v1/organizations/?search={marker}&page=1&page_size=1",
            token=token,
        )
        assert listed["pagination"]["totalItems"] == 1
        assert listed["data"][0]["id"] == organization_id
        assert listed["data"][0]["userCount"] == 0

        dropdown = api_client.request("GET", "/api/v1/organizations/dropdown", token=token)
        assert any(item["id"] == organization_id for item in dropdown["data"])

        users = api_client.request(
            "GET",
            f"/api/v1/organizations/{organization_id}/users?page=1&page_size=1",
            token=token,
        )
        assert users["data"] == []
        assert users["pagination"]["totalItems"] == 0

        public = api_client.request(
            "GET",
            "/api/v1/organizations/get-white-label-data-by-domain",
            org_domain=domain,
        )
        assert public["data"]["domain"] == domain
        assert public["data"]["siteTheme"] == {"brandMarker": marker}

        landing = api_client.request(
            "GET",
            "/api/v1/organizations/get-landing-page-by-domain",
            org_domain=domain,
        )
        assert landing["data"]["landingPageHtml"] is None

        mobile = api_client.request("GET", "/api/v1/organizations/mobile-list")
        assert any(item["id"] == organization_id for item in mobile["data"])

        denied = api_client.request(
            "GET",
            f"/api/v1/organizations/{organization_id}",
            token=api_client.access_token(org_admin_role),
            expected_status=403,
        )
        assert_error_envelope(denied)

        deleted_payload = api_client.request(
            "DELETE", f"/api/v1/organizations/{organization_id}", token=token
        )
        assert_success_envelope(deleted_payload)
        deleted = True

        missing = api_client.request(
            "GET",
            "/api/v1/organizations/get-white-label-data-by-domain",
            org_domain=domain,
            expected_status=404,
        )
        assert_error_envelope(missing)
        assert_camel_case_response(missing)
    finally:
        if organization_id is not None and not deleted:
            api_client.request(
                "DELETE",
                f"/api/v1/organizations/{organization_id}",
                token=token,
            )
