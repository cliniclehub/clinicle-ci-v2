from __future__ import annotations

import pytest

from conftest import ApiClient, assert_camel_case_response, assert_error_envelope, assert_success_envelope


pytestmark = pytest.mark.api


def test_get_white_label_data_by_domain_returns_public_branding(
    api_client: ApiClient,
    org_domain: str,
):
    payload = api_client.request(
        "GET",
        "/api/v1/organizations/get-white-label-data-by-domain",
        org_domain=org_domain,
    )

    assert_success_envelope(payload)
    assert payload["data"]["domain"] == org_domain
    assert_camel_case_response(payload)


def test_public_landing_page_and_mobile_organization_list(api_client: ApiClient, org_domain: str):
    landing_payload = api_client.request(
        "GET", "/api/v1/organizations/get-landing-page-by-domain", org_domain=org_domain
    )
    assert_success_envelope(landing_payload)
    assert_camel_case_response(landing_payload)

    mobile_payload = api_client.request("GET", "/api/v1/organizations/mobile-list")
    assert_success_envelope(mobile_payload)
    assert isinstance(mobile_payload["data"], list)
    assert_camel_case_response(mobile_payload)


def test_public_contact_form_rejects_invalid_payload_without_sending_email(
    api_client: ApiClient, org_domain: str
):
    payload = api_client.request(
        "POST",
        "/api/v1/organizations/contact-form",
        org_domain=org_domain,
        json_body={
            "name": "API contract",
            "email": "invalid",
            "category": "general",
            "subject": "Contract validation",
            "message": "short",
        },
        expected_status=422,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
