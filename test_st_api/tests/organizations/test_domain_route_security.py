from __future__ import annotations

import pytest

from conftest import ApiClient, assert_camel_case_response, assert_error_envelope


pytestmark = pytest.mark.api


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/organizations/dropdown", None),
        ("GET", "/api/v1/organizations/verify-domain-dns?domain=contract.invalid", None),
        ("POST", "/api/v1/organizations/add-domain-to-render", {"domain": "contract.invalid"}),
        ("POST", "/api/v1/organizations/add-domain-to-namecheap", {"domain": "contract.example.com"}),
    ],
)
def test_organization_domain_management_requires_authentication_before_provider_access(
    api_client: ApiClient,
    org_domain: str,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method, path, org_domain=org_domain, expected_status=401, **kwargs
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_domain_verification_requires_domain_query(api_client: ApiClient, org_admin_token: str):
    payload = api_client.request(
        "GET",
        "/api/v1/organizations/verify-domain-dns",
        token=org_admin_token,
        expected_status=422,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
