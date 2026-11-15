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
)


pytestmark = pytest.mark.api


@pytest.fixture
def disposable_email_reporting_rows(api_db_engine, org_domain: str) -> dict[str, str | int]:
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    marker = uuid4().hex
    queue_status = f"apiq_{marker[:20]}"
    log_status = f"apil_{marker[:20]}"
    recipient = f"api-{marker}@example.invalid"
    subject = f"API email evidence {marker}"
    with api_db_engine.begin() as connection:
        queue_id = connection.execute(
            text(
                f"""
                INSERT INTO {db_table('email_queue')} (
                    organization_id, template_key, to_emails, subject,
                    body_html, body_text, from_name, from_email, reply_to,
                    template_data, status, priority, attempts, max_attempts,
                    error_details, batch_name
                ) VALUES (
                    :organization_id, :template_key, CAST(:recipients AS text[]), :subject,
                    '<p>Disposable queue evidence</p>', 'Disposable queue evidence',
                    'API Tests', 'no-reply@example.invalid', 'support@example.invalid',
                    '{{"fixture":"pytest-api"}}'::jsonb, :queue_status, 5, 0, 3,
                    '{{"fixture":"pytest-api"}}'::jsonb, :batch_name
                ) RETURNING id
                """
            ),
            {
                "organization_id": organization_id,
                "template_key": f"api-template-{marker[:12]}",
                "recipients": [recipient],
                "subject": subject,
                "queue_status": queue_status,
                "batch_name": f"api-batch-{marker[:12]}",
            },
        ).scalar_one()
        log_id = connection.execute(
            text(
                f"""
                INSERT INTO {db_table('email_logs')} (
                    organization_id, queue_id, template_key, to_emails,
                    subject, body_html, body_text, from_name, from_email,
                    reply_to, template_data, status, priority, attempts,
                    max_attempts, open_count, click_count, error_message,
                    error_code, error_details, batch_name
                ) VALUES (
                    :organization_id, :queue_id, :template_key, CAST(:recipients AS text[]),
                    :subject, '<p>Disposable log evidence</p>', 'Disposable log evidence',
                    'API Tests', 'no-reply@example.invalid', 'support@example.invalid',
                    '{{"fixture":"pytest-api"}}'::jsonb, :log_status, 5, 1, 3,
                    0, 0, 'Disposable failure', 'API_TEST',
                    '{{"fixture":"pytest-api"}}'::jsonb, :batch_name
                ) RETURNING id
                """
            ),
            {
                "organization_id": organization_id,
                "queue_id": queue_id,
                "template_key": f"api-template-{marker[:12]}",
                "recipients": [recipient],
                "subject": subject,
                "log_status": log_status,
                "batch_name": f"api-batch-{marker[:12]}",
            },
        ).scalar_one()
    context = {
        "organization_id": organization_id,
        "queue_id": int(queue_id),
        "log_id": int(log_id),
        "queue_status": queue_status,
        "log_status": log_status,
        "recipient": recipient,
        "subject": subject,
    }
    try:
        yield context
    finally:
        with api_db_engine.begin() as connection:
            connection.execute(
                text(f"DELETE FROM {db_table('email_logs')} WHERE id = :id"),
                {"id": context["log_id"]},
            )
            connection.execute(
                text(f"DELETE FROM {db_table('email_queue')} WHERE id = :id"),
                {"id": context["queue_id"]},
            )


def _reporting_state(api_db_engine, context: dict[str, str | int]) -> dict:
    with api_db_engine.connect() as connection:
        queue = connection.execute(
            text(f"SELECT status, attempts, error_details FROM {db_table('email_queue')} WHERE id = :id"
            ),
            {"id": context["queue_id"]},
        ).mappings().one()
        log = connection.execute(
            text(f"SELECT status, attempts, error_details FROM {db_table('email_logs')} WHERE id = :id"
            ),
            {"id": context["log_id"]},
        ).mappings().one()
    return {"queue": dict(queue), "log": dict(log)}


def test_em_08_admin_filters_exact_queue_row_with_pagination_contract(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    disposable_email_reporting_rows: dict[str, str | int],
):
    context = disposable_email_reporting_rows
    payload = api_client.request(
        "GET",
        f"/api/v1/email-engine/queue?status_filter={context['queue_status']}"
        "&skip=0&limit=1",
        token=api_client.access_token(org_admin_role),
    )
    assert_success_envelope(payload)
    assert payload["data"]["totalCount"] == 1
    assert len(payload["data"]["queueItems"]) == 1
    item = payload["data"]["queueItems"][0]
    assert item["id"] == context["queue_id"]
    assert item["toEmails"] == [context["recipient"]]
    assert item["templateData"] == {"fixture": "pytest-api"}
    assert payload["pagination"] == {
        "page": 1,
        "pageSize": 1,
        "totalPages": 1,
        "totalItems": 1,
        "hasNextPage": False,
        "hasPrevPage": False,
    }
    assert_camel_case_response(payload)


@pytest.mark.parametrize("filter_style", ["single", "multiple"])
def test_em_08_admin_filters_and_searches_exact_failed_log(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    disposable_email_reporting_rows: dict[str, str | int],
    filter_style: str,
):
    context = disposable_email_reporting_rows
    status_query = (
        f"statusFilter={context['log_status']}"
        if filter_style == "single"
        else f"statusFilters=all&statusFilters={context['log_status']}"
    )
    payload = api_client.request(
        "GET",
        f"/api/v1/email-engine/logs?{status_query}&search={context['recipient']}"
        "&skip=0&limit=1",
        token=api_client.access_token(org_admin_role),
    )
    assert_success_envelope(payload)
    assert payload["data"]["totalCount"] == 1
    item = payload["data"]["logs"][0]
    assert item["id"] == context["log_id"]
    assert item["subject"] == context["subject"]
    assert item["errorCode"] == "API_TEST"
    assert item["errorDetails"] == {"fixture": "pytest-api"}
    assert_camel_case_response(payload)


def test_em_08_analytics_includes_disposable_status_without_mutating_evidence(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    disposable_email_reporting_rows: dict[str, str | int],
    api_db_engine,
):
    context = disposable_email_reporting_rows
    before = _reporting_state(api_db_engine, context)
    first = api_client.request(
        "GET", "/api/v1/email-engine/analytics", token=api_client.access_token(org_admin_role)
    )
    second = api_client.request(
        "GET", "/api/v1/email-engine/analytics", token=api_client.access_token(org_admin_role)
    )
    assert_success_envelope(first)
    assert first["data"] == second["data"]
    assert first["data"]["statusBreakdown"][context["log_status"]] == 1
    assert first["data"]["totalEmails"] >= 1
    assert _reporting_state(api_db_engine, context) == before


def test_tenant_b_admin_cannot_observe_tenant_a_queue_log_or_analytics_marker(
    api_client: ApiClient,
    tenant_b_org_admin_role: ApiRole,
    disposable_email_reporting_rows: dict[str, str | int],
):
    context = disposable_email_reporting_rows
    token = api_client.access_token(tenant_b_org_admin_role)
    queue = api_client.request(
        "GET",
        f"/api/v1/email-engine/queue?status_filter={context['queue_status']}",
        token=token,
    )
    logs = api_client.request(
        "GET",
        f"/api/v1/email-engine/logs?statusFilter={context['log_status']}",
        token=token,
    )
    analytics = api_client.request("GET", "/api/v1/email-engine/analytics", token=token)
    assert queue["data"] == {"queueItems": [], "totalCount": 0}
    assert logs["data"] == {"logs": [], "totalCount": 0}
    assert context["log_status"] not in analytics["data"]["statusBreakdown"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/v1/email-engine/logs?limit=1"),
        ("GET", "/api/v1/email-engine/analytics"),
        ("POST", "/api/v1/email-engine/process-queue?limit=1"),
    ],
)
def test_user_cannot_monitor_or_process_email_delivery_and_rows_are_unchanged(
    api_client: ApiClient,
    user_role: ApiRole,
    disposable_email_reporting_rows: dict[str, str | int],
    api_db_engine,
    method: str,
    path: str,
):
    before = _reporting_state(api_db_engine, disposable_email_reporting_rows)
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(user_role),
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert _reporting_state(api_db_engine, disposable_email_reporting_rows) == before
