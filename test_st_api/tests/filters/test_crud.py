from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import ApiClient, ApiRole, assert_camel_case_response, assert_success_envelope


pytestmark = pytest.mark.api


def _filter_payload(stamp: str, *, is_default: bool = False) -> dict:
    return {
        "name": f"API Filter {stamp}",
        "description": "Created by live API tests",
        "pageType": "users",
        "filterConfig": {
            "groupLogic": "AND",
            "groups": [
                {
                    "logic": "AND",
                    "conditions": [
                        {"field": "locked", "operator": "equals", "value": False}
                    ],
                }
            ],
        },
        "isDefault": is_default,
    }


def test_saved_filter_crud_round_trip(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")

    create_payload = api_client.request(
        "POST",
        "/api/v1/filters/",
        json_body=_filter_payload(stamp, is_default=True),
        token=token,
    )
    assert_success_envelope(create_payload)
    assert_camel_case_response(create_payload)
    saved_filter = create_payload["data"]

    list_payload = api_client.request(
        "GET",
        "/api/v1/filters/?page_type=users",
        token=token,
    )
    assert_success_envelope(list_payload)
    assert any(item["id"] == saved_filter["id"] for item in list_payload["data"])
    assert_camel_case_response(list_payload)

    default_payload = api_client.request(
        "GET",
        "/api/v1/filters/default/users",
        token=token,
    )
    assert_success_envelope(default_payload)
    assert default_payload["data"]["id"] == saved_filter["id"]
    assert_camel_case_response(default_payload)

    update_payload = api_client.request(
        "PUT",
        f"/api/v1/filters/{saved_filter['id']}",
        json_body={"description": "Updated by live API tests", "isDefault": False},
        token=token,
    )
    assert_success_envelope(update_payload)
    assert update_payload["data"]["description"] == "Updated by live API tests"
    assert_camel_case_response(update_payload)

    get_payload = api_client.request(
        "GET",
        f"/api/v1/filters/{saved_filter['id']}",
        token=token,
    )
    assert_success_envelope(get_payload)
    assert get_payload["data"]["id"] == saved_filter["id"]
    assert_camel_case_response(get_payload)

    delete_payload = api_client.request(
        "DELETE",
        f"/api/v1/filters/{saved_filter['id']}",
        token=token,
    )
    assert_success_envelope(delete_payload)
    assert_camel_case_response(delete_payload)
