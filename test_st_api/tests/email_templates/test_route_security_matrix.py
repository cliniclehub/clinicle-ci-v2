from __future__ import annotations
import pytest
from conftest import ApiClient, assert_camel_case_response, assert_error_envelope
pytestmark = pytest.mark.api
RESOURCE_ID = "00000000-0000-0000-0000-000000000001"

def test_restore_email_template_requires_authentication(api_client: ApiClient, org_domain: str):
    payload = api_client.request("POST", f"/api/v1/email-templates/{RESOURCE_ID}/restore-default", org_domain=org_domain, expected_status=401)
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
