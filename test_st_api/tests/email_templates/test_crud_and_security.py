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


def _template_payload(stamp: str) -> dict:
    return {
        "templateKey": f"api-test-{stamp}",
        "name": f"API Template {stamp}",
        "description": "Created by live API tests",
        "subject": "Hello {{name}}",
        "bodyHtml": "<p>Hello {{name}}</p>",
        "bodyText": "Hello {{name}}",
        "category": "transactional",
        "isActive": True,
        "availableFields": [{"key": "name", "label": "Name"}],
        "previewData": {"name": "Test User"},
    }


def test_email_template_crud_preview_and_test_round_trip(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")

    create_payload = api_client.request(
        "POST",
        "/api/v1/email-templates/",
        json_body=_template_payload(stamp),
        token=token,
        expected_status=201,
    )
    assert_success_envelope(create_payload)
    assert_camel_case_response(create_payload)
    template = create_payload["data"]

    list_payload = api_client.request(
        "GET",
        f"/api/v1/email-templates/?search=api-test-{stamp}&limit=10",
        token=token,
    )
    assert_success_envelope(list_payload)
    assert list_payload["data"]["totalCount"] >= 1
    assert_camel_case_response(list_payload)

    get_payload = api_client.request(
        "GET",
        f"/api/v1/email-templates/{template['id']}",
        token=token,
    )
    assert_success_envelope(get_payload)
    assert get_payload["data"]["id"] == template["id"]
    assert_camel_case_response(get_payload)

    preview_payload = api_client.request(
        "POST",
        f"/api/v1/email-templates/{template['id']}/preview",
        json_body={"name": "Preview User"},
        token=token,
    )
    assert_success_envelope(preview_payload)
    assert "Preview User" in preview_payload["data"]["subject"]
    assert_camel_case_response(preview_payload)

    test_payload = api_client.request(
        "POST",
        f"/api/v1/email-templates/{template['id']}/test",
        json_body={"name": "Rendered User"},
        token=token,
    )
    assert_success_envelope(test_payload)
    assert_camel_case_response(test_payload)

    update_payload = api_client.request(
        "PUT",
        f"/api/v1/email-templates/{template['id']}",
        json_body={"name": f"API Template Updated {stamp}"},
        token=token,
    )
    assert_success_envelope(update_payload)
    assert update_payload["data"]["name"] == f"API Template Updated {stamp}"
    assert_camel_case_response(update_payload)

    delete_payload = api_client.request(
        "DELETE",
        f"/api/v1/email-templates/{template['id']}",
        token=token,
    )
    assert_success_envelope(delete_payload)
    assert_camel_case_response(delete_payload)


def test_email_template_write_rejects_user_role(
    api_client: ApiClient,
    user_role: ApiRole,
):
    token = api_client.access_token(user_role)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")

    payload = api_client.request(
        "POST",
        "/api/v1/email-templates/",
        json_body=_template_payload(stamp),
        token=token,
        expected_status=403,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)
