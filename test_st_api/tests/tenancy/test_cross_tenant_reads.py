from __future__ import annotations

import json

import pytest
from sqlalchemy import text

from conftest import (
    db_table,
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
    first_tenant_resource_id,
    organization_id_for_domain,
    user_id_for_email,
)


pytestmark = pytest.mark.api


@pytest.mark.parametrize(
    ("resource", "path_template"),
    [
        ("media_asset", "/api/v1/media/assets/{id}"),
    ],
)
def test_tenant_b_admin_cannot_read_tenant_a_resources(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    tenant_b_org_admin_token: str,
    resource: str,
    path_template: str,
):
    tenant_a_id = organization_id_for_domain(api_db_engine, org_domain)
    resource_id = first_tenant_resource_id(api_db_engine, tenant_a_id, resource)

    payload = api_client.request(
        "GET",
        path_template.format(id=resource_id),
        token=tenant_b_org_admin_token,
        expected_status=404,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("resource", "path"),
    [
        ("media_asset", "/api/v1/media/assets?limit=500"),
    ],
)
def test_tenant_b_lists_never_project_tenant_a_resource_ids_even_with_spoofed_domain_header(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    tenant_b_org_admin_token: str,
    resource: str,
    path: str,
):
    tenant_a_id = organization_id_for_domain(api_db_engine, org_domain)
    tenant_a_resource_id = first_tenant_resource_id(
        api_db_engine, tenant_a_id, resource
    )

    payload = api_client.request(
        "GET",
        path,
        token=tenant_b_org_admin_token,
        org_domain=org_domain,
    )

    assert_success_envelope(payload)
    assert tenant_a_resource_id not in json.dumps(payload.get("data")), (
        f"Tenant B list leaked Tenant A {resource} {tenant_a_resource_id}"
    )
    assert_camel_case_response(payload)


def test_tenant_b_admin_cannot_read_tenant_a_user_record(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    user_role: ApiRole,
    tenant_b_org_admin_token: str,
):
    tenant_a_id = organization_id_for_domain(api_db_engine, org_domain)
    tenant_a_user_id = user_id_for_email(
        api_db_engine, tenant_a_id, user_role.email
    )

    payload = api_client.request(
        "GET",
        f"/api/v1/users/org/{tenant_a_user_id}",
        token=tenant_b_org_admin_token,
        org_domain=org_domain,
        expected_status=404,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_tenant_b_user_list_cannot_leak_tenant_a_identity_with_spoofed_header(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    user_role: ApiRole,
    tenant_b_org_admin_token: str,
):
    tenant_a_id = organization_id_for_domain(api_db_engine, org_domain)
    tenant_a_user_id = user_id_for_email(
        api_db_engine, tenant_a_id, user_role.email
    )

    payload = api_client.request(
        "GET",
        "/api/v1/users/org?page=1&pageSize=100",
        token=tenant_b_org_admin_token,
        org_domain=org_domain,
    )

    assert_success_envelope(payload)
    serialized = json.dumps(payload.get("data"))
    assert tenant_a_user_id not in serialized
    assert user_role.email.lower() not in serialized.lower()
    assert_camel_case_response(payload)


TENANT_MUTATION_CASES = [
    (
        "media_asset",
        "PATCH",
        "/api/v1/media/assets/{id}/rename",
        {"fileName": "cross-tenant-mutation.txt"},
        f"SELECT source_object_key FROM {db_table('media_assets')} WHERE id = :id",
    ),
]


@pytest.mark.parametrize(
    ("resource", "method", "path_template", "body", "snapshot_query"),
    TENANT_MUTATION_CASES,
)
def test_tenant_b_admin_cannot_mutate_tenant_a_resources_and_database_is_unchanged(
    api_client: ApiClient,
    api_db_engine,
    org_domain: str,
    tenant_b_org_admin_token: str,
    resource: str,
    method: str,
    path_template: str,
    body: dict,
    snapshot_query: str,
):
    tenant_a_id = organization_id_for_domain(api_db_engine, org_domain)
    resource_id = first_tenant_resource_id(api_db_engine, tenant_a_id, resource)

    with api_db_engine.connect() as conn:
        before = conn.execute(text(snapshot_query), {"id": resource_id}).scalar()

    payload = api_client.request(
        method,
        path_template.format(id=resource_id),
        token=tenant_b_org_admin_token,
        org_domain=org_domain,
        json_body=body,
        expected_status=404,
    )

    with api_db_engine.connect() as conn:
        after = conn.execute(text(snapshot_query), {"id": resource_id}).scalar()

    assert_error_envelope(payload)
    assert after == before, f"Denied cross-tenant {resource} mutation changed persistent state"
    assert_camel_case_response(payload)
