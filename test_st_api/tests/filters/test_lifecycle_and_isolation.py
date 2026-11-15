from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from conftest import (
    db_table,
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
)


pytestmark = pytest.mark.api


def _config(*, value: bool = False, group_logic: str = "AND") -> dict:
    return {
        "groupLogic": group_logic,
        "groups": [
            {
                "logic": "AND",
                "conditions": [
                    {"field": "locked", "operator": "equals", "value": value}
                ],
            }
        ],
    }


def _create_filter(
    api_client: ApiClient,
    token: str,
    *,
    name: str,
    page_type: str = "users",
    is_default: bool = False,
) -> dict:
    payload = api_client.request(
        "POST",
        "/api/v1/filters/",
        json_body={
            "name": name,
            "description": "Disposable live API contract fixture",
            "pageType": page_type,
            "filterConfig": _config(),
            "isDefault": is_default,
        },
        token=token,
    )
    assert_success_envelope(payload)
    assert_camel_case_response(payload)
    return payload["data"]


def _persisted_filters(api_db_engine, user_id: str) -> list[dict]:
    with api_db_engine.connect() as connection:
        rows = connection.execute(
            text(
                f"""
                SELECT id, organization_id, user_id, name, page_type,
                       filter_config, is_default
                FROM {db_table('saved_filters')}
                WHERE user_id = :user_id
                ORDER BY id
                """
            ),
            {"user_id": user_id},
        ).mappings()
        return [dict(row) for row in rows]


@pytest.fixture
def saved_filter_context(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    api_db_engine,
) -> Iterator[dict[str, object]]:
    login = api_client.login(org_admin_role)
    token = login["data"]["tokens"]["accessToken"]
    user_id = login["data"]["user"]["id"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    first = _create_filter(
        api_client,
        token,
        name=f"API default filter A {stamp}",
        is_default=True,
    )
    context: dict[str, object] = {
        "token": token,
        "user_id": user_id,
        "stamp": stamp,
        "first": first,
    }
    yield context
    with api_db_engine.begin() as connection:
        connection.execute(
            text(f"DELETE FROM {db_table('saved_filters')} WHERE user_id = :user_id AND name LIKE :name"),
            {"user_id": user_id, "name": f"API % {stamp}"},
        )


def test_saved_filter_default_handoff_persists_once_per_page_type(
    api_client: ApiClient,
    saved_filter_context: dict[str, object],
    api_db_engine,
):
    token = str(saved_filter_context["token"])
    user_id = str(saved_filter_context["user_id"])
    stamp = str(saved_filter_context["stamp"])
    first = saved_filter_context["first"]
    assert isinstance(first, dict)

    second = _create_filter(
        api_client,
        token,
        name=f"API default filter B {stamp}",
        is_default=True,
    )
    rows = [row for row in _persisted_filters(api_db_engine, user_id) if stamp in row["name"]]
    assert len(rows) == 2
    assert [row["id"] for row in rows if row["is_default"]] == [second["id"]]

    default = api_client.request(
        "GET", "/api/v1/filters/default/users", token=token
    )
    assert_success_envelope(default)
    assert default["data"]["id"] == second["id"]

    repeated = api_client.request(
        "PUT",
        f"/api/v1/filters/{second['id']}",
        json_body={"isDefault": True},
        token=token,
    )
    assert_success_envelope(repeated)
    replay_rows = [row for row in _persisted_filters(api_db_engine, user_id) if stamp in row["name"]]
    assert len(replay_rows) == 2
    assert [row["id"] for row in replay_rows if row["is_default"]] == [second["id"]]
    assert all(row["id"] != first["id"] or not row["is_default"] for row in replay_rows)


def test_saved_filter_listing_and_config_update_are_exact(
    api_client: ApiClient,
    saved_filter_context: dict[str, object],
    api_db_engine,
):
    token = str(saved_filter_context["token"])
    user_id = str(saved_filter_context["user_id"])
    stamp = str(saved_filter_context["stamp"])
    first = saved_filter_context["first"]
    assert isinstance(first, dict)
    alternate_filter = _create_filter(
        api_client,
        token,
        name=f"API users filter {stamp}",
        page_type="users",
    )

    users = api_client.request("GET", "/api/v1/filters/?page_type=users", token=token)
    assert_success_envelope(users)
    assert first["id"] in {item["id"] for item in users["data"]}
    assert alternate_filter["id"] in {item["id"] for item in users["data"]}

    new_config = _config(value=True, group_logic="OR")
    updated = api_client.request(
        "PUT",
        f"/api/v1/filters/{first['id']}",
        json_body={"filterConfig": new_config},
        token=token,
    )
    assert_success_envelope(updated)
    assert updated["data"]["filterConfig"] == new_config
    persisted = next(row for row in _persisted_filters(api_db_engine, user_id) if row["id"] == first["id"])
    assert persisted["filter_config"] == new_config


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [
        ({"name": " ", "pageType": "users", "filterConfig": _config()}, 422),
        ({"name": "Bad page", "pageType": "orders", "filterConfig": _config()}, 422),
        ({"name": "Missing groups", "pageType": "users", "filterConfig": {"groupLogic": "AND"}}, 422),
        ({"name": "Bad group logic", "pageType": "users", "filterConfig": _config(group_logic="XOR")}, 422),
        (
            {
                "name": "Bad nested condition",
                "pageType": "users",
                "filterConfig": {"groupLogic": "AND", "groups": [{"logic": "AND", "conditions": [{}]}]},
            },
            400,
        ),
    ],
)
def test_invalid_saved_filter_create_rolls_back_without_a_write(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    api_db_engine,
    payload: dict,
    expected_status: int,
):
    login = api_client.login(org_admin_role)
    token = login["data"]["tokens"]["accessToken"]
    user_id = login["data"]["user"]["id"]
    before = _persisted_filters(api_db_engine, user_id)
    denied = api_client.request(
        "POST",
        "/api/v1/filters/",
        json_body=payload,
        token=token,
        expected_status=expected_status,
    )
    assert_error_envelope(denied)
    assert _persisted_filters(api_db_engine, user_id) == before


def test_invalid_saved_filter_update_preserves_existing_config_and_default(
    api_client: ApiClient,
    saved_filter_context: dict[str, object],
    api_db_engine,
):
    token = str(saved_filter_context["token"])
    user_id = str(saved_filter_context["user_id"])
    first = saved_filter_context["first"]
    assert isinstance(first, dict)
    before = next(row for row in _persisted_filters(api_db_engine, user_id) if row["id"] == first["id"])
    payload = api_client.request(
        "PUT",
        f"/api/v1/filters/{first['id']}",
        json_body={
            "filterConfig": {
                "groupLogic": "AND",
                "groups": [{"logic": "SIDEWAYS", "conditions": []}],
            },
            "isDefault": False,
        },
        token=token,
        expected_status=400,
    )
    assert_error_envelope(payload)
    after = next(row for row in _persisted_filters(api_db_engine, user_id) if row["id"] == first["id"])
    assert after == before


def test_tenant_b_cannot_read_update_delete_or_list_tenant_a_saved_filter(
    api_client: ApiClient,
    tenant_b_org_admin_role: ApiRole,
    saved_filter_context: dict[str, object],
    api_db_engine,
):
    token = api_client.access_token(tenant_b_org_admin_role)
    user_id = str(saved_filter_context["user_id"])
    first = saved_filter_context["first"]
    assert isinstance(first, dict)
    before = _persisted_filters(api_db_engine, user_id)

    listed = api_client.request("GET", "/api/v1/filters/", token=token)
    assert_success_envelope(listed)
    assert first["id"] not in {item["id"] for item in listed["data"]}

    for method, body in (("GET", None), ("PUT", {"name": "Tenant B overwrite"}), ("DELETE", None)):
        payload = api_client.request(
            method,
            f"/api/v1/filters/{first['id']}",
            json_body=body,
            token=token,
            expected_status=404,
        )
        assert_error_envelope(payload)
        assert_camel_case_response(payload)
    assert _persisted_filters(api_db_engine, user_id) == before


def test_delete_saved_filter_is_persistent_and_replay_safe(
    api_client: ApiClient,
    saved_filter_context: dict[str, object],
    api_db_engine,
):
    token = str(saved_filter_context["token"])
    user_id = str(saved_filter_context["user_id"])
    first = saved_filter_context["first"]
    assert isinstance(first, dict)
    deleted = api_client.request(
        "DELETE", f"/api/v1/filters/{first['id']}", token=token
    )
    assert_success_envelope(deleted)
    assert all(row["id"] != first["id"] for row in _persisted_filters(api_db_engine, user_id))

    for method in ("GET", "DELETE"):
        replay = api_client.request(
            method,
            f"/api/v1/filters/{first['id']}",
            token=token,
            expected_status=404,
        )
        assert_error_envelope(replay)
    assert all(row["id"] != first["id"] for row in _persisted_filters(api_db_engine, user_id))


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/v1/filters/", {
            "name": "Denied",
            "pageType": "users",
            "filterConfig": {"groupLogic": "AND", "groups": []},
        }),
        ("GET", "/api/v1/filters/", None),
        ("GET", "/api/v1/filters/0", None),
        ("PUT", "/api/v1/filters/0", {"name": "Denied"}),
        ("DELETE", "/api/v1/filters/0", None),
        ("GET", "/api/v1/filters/default/users", None),
    ],
)
def test_user_is_denied_from_every_saved_filter_route(
    api_client: ApiClient,
    user_role: ApiRole,
    method: str,
    path: str,
    body: dict | None,
):
    payload = api_client.request(
        method,
        path,
        json_body=body,
        token=api_client.access_token(user_role),
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
