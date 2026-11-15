from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote
from uuid import uuid4

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def test_org_user_create_list_and_cleanup(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    """Typical-org baseline: org admin creates a disposable user on Test Org A, lists it, deletes it."""
    token = api_client.access_token(org_admin_role)

    me = api_client.request("GET", "/api/v1/users/me", token=token)
    assert_success_envelope(me)
    organization_id = me["data"]["organizationId"]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    email = f"st+run-api-{stamp}-{uuid4().hex[:6]}@testorg-a.clinicle-test.com"
    password = "St!Passw0rd#2026"
    created_id: str | None = None

    try:
        create_payload = api_client.request(
            "POST",
            "/api/v1/users/org",
            token=token,
            json_body={
                "email": email,
                "password": password,
                "firstName": "Api",
                "lastName": "Baseline",
                "organizationId": organization_id,
                "roles": ["user"],
                "skipEmailVerification": True,
            },
        )
        assert_success_envelope(create_payload)
        assert_camel_case_response(create_payload)
        created_id = create_payload["data"]["id"]
        assert create_payload["data"]["email"] == email

        list_payload = api_client.request(
            "GET",
            f"/api/v1/users/org?page=1&pageSize=100&search={quote(email)}",
            token=token,
        )
        assert_success_envelope(list_payload)
        rows = list_payload["data"]
        assert isinstance(rows, list)
        assert any(row.get("id") == created_id or row.get("email") == email for row in rows)
        assert_camel_case_response(list_payload)
    finally:
        if created_id:
            api_client.request(
                "DELETE",
                f"/api/v1/users/org/{created_id}",
                token=token,
            )
