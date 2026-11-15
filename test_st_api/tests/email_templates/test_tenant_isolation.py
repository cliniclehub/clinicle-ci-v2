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


def _payload(stamp: str) -> dict:
    return {
        "templateKey": f"tenant-isolation-{stamp}",
        "name": f"Tenant isolation {stamp}",
        "subject": "Hello {{name}}",
        "bodyHtml": "<p>Hello {{name}}</p>",
        "bodyText": "Hello {{name}}",
        "category": "transactional",
        "availableFields": [{"field": "name", "label": "Name"}],
        "previewData": {"name": "Example User"},
    }


def test_tenant_b_cannot_list_read_update_or_delete_tenant_a_template(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    tenant_b_org_admin_role: ApiRole,
):
    tenant_a_token = api_client.access_token(org_admin_role)
    tenant_b_token = api_client.access_token(tenant_b_org_admin_role)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")

    created_payload = api_client.request(
        "POST",
        "/api/v1/email-templates/",
        json_body=_payload(stamp),
        token=tenant_a_token,
        expected_status=201,
    )
    assert_success_envelope(created_payload)
    template = created_payload["data"]

    try:
        listed = api_client.request(
            "GET", "/api/v1/email-templates/?limit=1000", token=tenant_b_token
        )
        assert_success_envelope(listed)
        assert template["id"] not in {item["id"] for item in listed["data"]["templates"]}

        for method, body in (
            ("GET", None),
            ("PUT", {"name": "Tenant B overwrite"}),
            ("DELETE", None),
        ):
            kwargs = {"json_body": body} if body is not None else {}
            denied = api_client.request(
                method,
                f"/api/v1/email-templates/{template['id']}",
                token=tenant_b_token,
                expected_status=404,
                **kwargs,
            )
            assert_error_envelope(denied)
            assert_camel_case_response(denied)

        unchanged = api_client.request(
            "GET", f"/api/v1/email-templates/{template['id']}", token=tenant_a_token
        )
        assert unchanged["data"]["name"] == template["name"]
    finally:
        api_client.request(
            "DELETE", f"/api/v1/email-templates/{template['id']}", token=tenant_a_token
        )
