from __future__ import annotations

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_error_envelope


pytestmark = pytest.mark.api
RESOURCE_ID = "00000000-0000-0000-0000-000000000001"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/organizations/my-organization", None),
        ("PATCH", "/api/v1/organizations/my-organization", {"city": "Auth"}),
        ("GET", "/api/v1/organizations/", None),
        ("POST", "/api/v1/organizations/", {"name": "Auth", "domain": "auth.invalid"}),
        ("GET", f"/api/v1/organizations/{RESOURCE_ID}", None),
        ("PATCH", f"/api/v1/organizations/{RESOURCE_ID}", {"city": "Auth"}),
        ("DELETE", f"/api/v1/organizations/{RESOURCE_ID}", None),
        ("GET", f"/api/v1/organizations/{RESOURCE_ID}/users", None),
        ("GET", "/api/v1/organizations/dropdown", None),
        ("GET", "/api/v1/organizations/verify-domain-dns?domain=auth.invalid", None),
        ("POST", "/api/v1/organizations/add-domain-to-render", {"domain": "auth.invalid"}),
        ("POST", "/api/v1/organizations/add-domain-to-namecheap", {"domain": "auth.example.com"}),
    ],
)
def test_every_protected_organization_route_requires_authentication(
    api_client: ApiClient,
    org_domain: str,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        org_domain=org_domain,
        expected_status=401,
        **kwargs,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/organizations/", None),
        ("POST", "/api/v1/organizations/", {"name": "No", "domain": "no.invalid"}),
        ("GET", f"/api/v1/organizations/{RESOURCE_ID}", None),
        ("PATCH", f"/api/v1/organizations/{RESOURCE_ID}", {"city": "No"}),
        ("DELETE", f"/api/v1/organizations/{RESOURCE_ID}", None),
        ("GET", f"/api/v1/organizations/{RESOURCE_ID}/users", None),
        ("GET", "/api/v1/organizations/dropdown", None),
        ("POST", "/api/v1/organizations/add-domain-to-namecheap", {"domain": "no.example.com"}),
    ],
)
def test_org_admin_cannot_use_platform_organization_administration_routes(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(org_admin_role),
        expected_status=403,
        **kwargs,
    )
    assert_error_envelope(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/api/v1/organizations/my-organization", {"city": "No"}),
        ("GET", "/api/v1/organizations/verify-domain-dns?domain=no.invalid", None),
        ("POST", "/api/v1/organizations/add-domain-to-render", {"domain": "no.invalid"}),
        ("POST", "/api/v1/organizations/add-domain-to-namecheap", {"domain": "no.example.com"}),
    ],
)
def test_user_cannot_mutate_organization_or_access_provider_administration(
    api_client: ApiClient,
    user_role: ApiRole,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(user_role),
        expected_status=403,
        **kwargs,
    )
    assert_error_envelope(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/organizations/?page=0", None),
        ("GET", "/api/v1/organizations/?page_size=0", None),
        ("GET", "/api/v1/organizations/?page_size=101", None),
        ("GET", f"/api/v1/organizations/{RESOURCE_ID}/users?page=0", None),
        ("GET", f"/api/v1/organizations/{RESOURCE_ID}/users?page_size=101", None),
        ("DELETE", "/api/v1/organizations/not-a-uuid", None),
        (
            "POST",
            "/api/v1/organizations/",
            {"name": "Bad domain", "domain": "not-a-domain"},
        ),
        (
            "POST",
            "/api/v1/organizations/",
            {"name": "Bad timezone", "domain": "timezone.invalid", "timezone": "Moon/Base"},
        ),
    ],
)
def test_platform_organization_contract_rejects_invalid_ids_bounds_and_identity(
    api_client: ApiClient,
    super_admin_role: ApiRole,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(super_admin_role),
        expected_status=422,
        **kwargs,
    )
    assert_error_envelope(payload)


def test_org_settings_reject_invalid_timezone(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    payload = api_client.request(
        "PATCH",
        "/api/v1/organizations/my-organization",
        json_body={"timezone": "Moon/Base"},
        token=api_client.access_token(org_admin_role),
        expected_status=422,
    )
    assert_error_envelope(payload)
