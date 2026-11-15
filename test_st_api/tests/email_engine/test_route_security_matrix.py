from __future__ import annotations
import pytest
from conftest import ApiClient, assert_camel_case_response, assert_error_envelope
pytestmark = pytest.mark.api

@pytest.mark.parametrize(("path", "body"), [("/api/v1/email-engine/send", {"to_emails": ["contract@example.com"], "template_data": {"subject": "Contract", "body": "Contract"}}), ("/api/v1/email-engine/process-queue?limit=1", None)])
def test_email_engine_mutations_require_authentication_before_delivery(api_client: ApiClient, org_domain: str, path: str, body: dict | None):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request("POST", path, org_domain=org_domain, expected_status=401, **kwargs)
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
