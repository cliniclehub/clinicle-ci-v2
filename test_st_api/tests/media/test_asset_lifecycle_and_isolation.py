from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text

from conftest import (
    db_table,
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
    organization_id_for_domain,
    role_by_slug,
)


pytestmark = pytest.mark.api


def _key(organization_id: str, name: str | None = None) -> str:
    return f"orgs/{organization_id}/media/{name or f'api-{uuid4().hex}.pdf'}"


def _asset_row(api_db_engine, source_object_key: str) -> dict | None:
    with api_db_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT id, organization_id, source_object_key, display_name, media_type, "
                "source_mime_type, source_size_bytes, status "
                f"FROM {db_table('media_assets')} WHERE source_object_key = :key"
            ),
            {"key": source_object_key},
        ).mappings().one_or_none()
    if row is None:
        return None
    return {
        key: str(value) if key in {"id", "organization_id"} else value
        for key, value in row.items()
    }


def _delete_asset_row(api_db_engine, source_object_key: str) -> None:
    with api_db_engine.begin() as connection:
        connection.execute(
            text(f"DELETE FROM {db_table('media_assets')} WHERE source_object_key = :key"),
            {"key": source_object_key},
        )


@pytest.fixture
def tracked_pdf_asset(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    org_admin_role: ApiRole,
):
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    object_key = _key(organization_id)
    token = api_client.access_token(org_admin_role)
    payload = api_client.request(
        "POST",
        "/api/v1/media/assets",
        token=token,
        json_body={
            "sourceObjectKey": object_key,
            "sourceMimeType": "application/pdf",
            "sourceSizeBytes": 4096,
        },
    )
    assert_success_envelope(payload)
    try:
        yield {
            "asset": payload["data"],
            "key": object_key,
            "token": token,
            "organization_id": organization_id,
        }
    finally:
        _delete_asset_row(api_db_engine, object_key)

def test_med_02_asset_create_infers_type_and_persists_tenant_metadata(
    api_db_engine,
    tracked_pdf_asset: dict,
):
    asset = tracked_pdf_asset["asset"]
    persisted = _asset_row(api_db_engine, tracked_pdf_asset["key"])
    assert persisted is not None
    assert asset["id"] == persisted["id"]
    assert asset["organizationId"] == tracked_pdf_asset["organization_id"]
    assert persisted["organization_id"] == tracked_pdf_asset["organization_id"]
    assert persisted["media_type"] == "pdf"
    assert persisted["status"] == "ready"
    assert persisted["source_size_bytes"] == 4096
    assert asset["displayName"].endswith(".pdf")


def test_med_01_asset_create_is_idempotent_for_same_tenant_source(
    api_client: ApiClient,
    api_db_engine,
    tracked_pdf_asset: dict,
):
    first = tracked_pdf_asset["asset"]
    replay = api_client.request(
        "POST",
        "/api/v1/media/assets",
        token=tracked_pdf_asset["token"],
        json_body={
            "sourceObjectKey": tracked_pdf_asset["key"],
            "mediaType": "pdf",
            "sourceMimeType": "application/pdf",
            "sourceSizeBytes": 4096,
        },
    )
    assert_success_envelope(replay)
    assert replay["data"]["id"] == first["id"]
    with api_db_engine.connect() as connection:
        count = connection.execute(
            text(f"SELECT count(*) FROM {db_table('media_assets')} WHERE source_object_key = :key"),
            {"key": tracked_pdf_asset["key"]},
        ).scalar_one()
    assert count == 1
    assert_camel_case_response(replay)


def test_med_02_asset_detail_and_filtered_list_reconcile_to_database(
    api_client: ApiClient,
    tracked_pdf_asset: dict,
):
    asset_id = tracked_pdf_asset["asset"]["id"]
    detail = api_client.request(
        "GET", f"/api/v1/media/assets/{asset_id}", token=tracked_pdf_asset["token"]
    )
    listed = api_client.request(
        "GET",
        "/api/v1/media/assets?status=ready&mediaType=pdf&limit=500",
        token=tracked_pdf_asset["token"],
    )
    assert_success_envelope(detail)
    assert_success_envelope(listed)
    assert detail["data"]["id"] == asset_id
    matches = [item for item in listed["data"]["assets"] if item["id"] == asset_id]
    assert len(matches) == 1
    assert matches[0]["sourceObjectKey"] == tracked_pdf_asset["key"]
    assert_camel_case_response(detail)
    assert_camel_case_response(listed)


def test_med_07_foreign_tenant_cannot_read_or_project_tenant_asset(
    api_client: ApiClient,
    tenant_b_org_admin_role: ApiRole,
    tracked_pdf_asset: dict,
):
    token = api_client.access_token(tenant_b_org_admin_role)
    asset_id = tracked_pdf_asset["asset"]["id"]
    denied = api_client.request(
        "GET", f"/api/v1/media/assets/{asset_id}", token=token, expected_status=404
    )
    assert_error_envelope(denied)
    listed = api_client.request("GET", "/api/v1/media/assets?limit=500", token=token)
    assert_success_envelope(listed)
    assert asset_id not in {item["id"] for item in listed["data"]["assets"]}
    assert tracked_pdf_asset["key"] not in {
        item["sourceObjectKey"] for item in listed["data"]["assets"]
    }


@pytest.mark.parametrize(
    ("object_key", "expected_status"),
    [
        ("orgs/00000000-0000-0000-0000-000000000001/media/foreign.pdf", 403),
        ("orgs/00000000-0000-0000-0000-000000000001/media/../escape.pdf", 422),
        ("not-an-org/media/file.pdf", 403),
    ],
)
def test_med_01_asset_create_rejects_foreign_traversal_and_malformed_keys(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    object_key: str,
    expected_status: int,
):
    payload = api_client.request(
        "POST",
        "/api/v1/media/assets",
        token=api_client.access_token(org_admin_role),
        json_body={"sourceObjectKey": object_key, "mediaType": "pdf"},
        expected_status=expected_status,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/v1/media/assets", {"sourceObjectKey": "orgs/00000000-0000-0000-0000-000000000001/media/denied.pdf"}),
        ("GET", "/api/v1/media/assets?limit=1", None),
        ("POST", "/api/v1/media/assets/reconcile?dryRun=true", None),
    ],
)
def test_med_02_user_cannot_manage_or_inventory_media_library(
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
    assert_camel_case_response(payload)


def test_med_04_user_cannot_sign_unused_private_object(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    user_role: ApiRole,
):
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    payload = api_client.request(
        "POST",
        "/api/v1/media/sign-access",
        token=api_client.access_token(user_role),
        json_body={"objectKey": _key(organization_id, "unattached-private.pdf")},
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.xfail(
    strict=True,
    reason="MED-02 gap: unknown status and mediaType filters are silently accepted as empty lists",
)
@pytest.mark.parametrize(
    "query",
    ["status=not-a-state", "mediaType=not-a-type"],
)
def test_med_02_asset_list_rejects_unknown_filters(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    query: str,
):
    payload = api_client.request(
        "GET",
        f"/api/v1/media/assets?{query}",
        token=api_client.access_token(org_admin_role),
        expected_status=422,
    )
    assert_error_envelope(payload)


@pytest.mark.xfail(
    strict=True,
    reason="MED-01 gap: asset metadata accepts a negative source size",
)
def test_med_01_asset_create_rejects_negative_size_without_write(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    org_admin_role: ApiRole,
):
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    object_key = _key(organization_id, "negative-size.pdf")
    try:
        payload = api_client.request(
            "POST",
            "/api/v1/media/assets",
            token=api_client.access_token(org_admin_role),
            json_body={"sourceObjectKey": object_key, "sourceSizeBytes": -1},
            expected_status=422,
        )
        assert_error_envelope(payload)
        assert _asset_row(api_db_engine, object_key) is None
    finally:
        _delete_asset_row(api_db_engine, object_key)
