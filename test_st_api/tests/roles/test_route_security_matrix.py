from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import (
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
)

pytestmark = pytest.mark.api


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/roles/permissions", None),
        ("GET", "/api/v1/roles/assignable", None),
        ("GET", "/api/v1/roles/manage", None),
        ("POST", "/api/v1/roles/custom", {"label": "Support", "permissions": []}),
        ("PATCH", "/api/v1/roles/custom/1", {"label": "Support"}),
        ("DELETE", "/api/v1/roles/custom/1", None),
    ],
)
def test_role_routes_require_authentication(
    api_client: ApiClient, method: str, path: str, body: dict | None
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(method, path, expected_status=401, **kwargs)
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_org_admin_can_list_assignable_roles(api_client: ApiClient, org_admin_token: str):
    payload = api_client.request(
        "GET", "/api/v1/roles/assignable", token=org_admin_token, expected_status=200
    )
    assert payload["status"] == "success"
    assert isinstance(payload["data"], list)
    assert_camel_case_response(payload)


def test_org_admin_can_list_roles_for_management(
    api_client: ApiClient, org_admin_token: str
):
    payload = api_client.request(
        "GET", "/api/v1/roles/manage", token=org_admin_token, expected_status=200
    )
    assert_success_envelope(payload)
    assert isinstance(payload["data"], list)
    assert_camel_case_response(payload)


def test_custom_roles_are_isolated_between_organizations(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    tenant_b_org_admin_role: ApiRole,
):
    tenant_a_token = api_client.access_token(org_admin_role)
    tenant_b_token = api_client.access_token(tenant_b_org_admin_role)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    created = api_client.request(
        "POST",
        "/api/v1/roles/custom",
        json_body={"label": f"Tenant A support {stamp}", "permissions": []},
        token=tenant_a_token,
        expected_status=201,
    )
    assert_success_envelope(created)
    role = created["data"]

    try:
        listed = api_client.request(
            "GET", "/api/v1/roles/assignable", token=tenant_b_token
        )
        assert_success_envelope(listed)
        assert role["id"] not in {item["id"] for item in listed["data"]}

        for method, body in (
            ("PATCH", {"label": "Tenant B overwrite"}),
            ("DELETE", None),
        ):
            kwargs = {"json_body": body} if body is not None else {}
            denied = api_client.request(
                method,
                f"/api/v1/roles/custom/{role['id']}",
                token=tenant_b_token,
                expected_status=404,
                **kwargs,
            )
            assert_error_envelope(denied)

        unchanged = api_client.request(
            "GET", "/api/v1/roles/assignable", token=tenant_a_token
        )
        assert next(item for item in unchanged["data"] if item["id"] == role["id"])[
            "label"
        ] == role["label"]
    finally:
        api_client.request(
            "DELETE", f"/api/v1/roles/custom/{role['id']}", token=tenant_a_token
        )
