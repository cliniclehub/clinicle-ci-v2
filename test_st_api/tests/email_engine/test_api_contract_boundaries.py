from __future__ import annotations

import pytest

from conftest import (
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
)


pytestmark = pytest.mark.api


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/v1/email-engine/send", {"to_emails": []}),
        ("POST", "/api/v1/email-engine/process-queue?limit=1", None),
        ("GET", "/api/v1/email-engine/queue?limit=1", None),
        ("GET", "/api/v1/email-engine/logs?limit=1", None),
        ("GET", "/api/v1/email-engine/analytics", None),
    ],
)
def test_every_email_engine_route_requires_authentication(
    api_client: ApiClient,
    org_domain: str,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        org_domain=org_domain,
        expected_status=401,
        **kwargs,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/v1/email-engine/send",
            {
                "to_emails": ["must-not-send@example.invalid"],
                "template_data": {
                    "subject": "Authorization boundary",
                    "body": "This request must be rejected before delivery.",
                },
            },
        ),
        ("/api/v1/email-engine/process-queue?limit=1", None),
    ],
)
def test_user_cannot_send_or_process_email(
    api_client: ApiClient,
    user_role: ApiRole,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        "POST",
        path,
        token=api_client.access_token(user_role),
        expected_status=403,
        **kwargs,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/v1/email-engine/process-queue?limit=0", None),
        ("POST", "/api/v1/email-engine/process-queue?limit=101", None),
        ("GET", "/api/v1/email-engine/queue?skip=-1", None),
        ("GET", "/api/v1/email-engine/queue?limit=0", None),
        ("GET", "/api/v1/email-engine/queue?limit=1001", None),
        ("GET", "/api/v1/email-engine/logs?skip=-1", None),
        ("GET", "/api/v1/email-engine/logs?limit=0", None),
        ("GET", "/api/v1/email-engine/logs?limit=1001", None),
        ("GET", "/api/v1/email-engine/logs?templateId=not-a-uuid", None),
        (
            "POST",
            "/api/v1/email-engine/send",
            {"to_emails": ["must-not-send@example.invalid"], "priority": 0},
        ),
        (
            "POST",
            "/api/v1/email-engine/send",
            {"to_emails": ["must-not-send@example.invalid"], "priority": 11},
        ),
    ],
)
def test_email_engine_rejects_malformed_bounds_before_service_or_provider_calls(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    method: str,
    path: str,
    body: dict | None,
):
    kwargs = {"json_body": body} if body is not None else {}
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(org_admin_role),
        expected_status=422,
        **kwargs,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_send_rejects_an_empty_recipient_list_without_delivery(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    payload = api_client.request(
        "POST",
        "/api/v1/email-engine/send",
        json_body={"to_emails": []},
        token=api_client.access_token(org_admin_role),
        expected_status=400,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.xfail(
    strict=True,
    reason="BR-15 gap: queue status filters accept arbitrary strings instead of a lifecycle allowlist",
)
def test_br_15_queue_status_filter_rejects_unknown_lifecycle_value(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    payload = api_client.request(
        "GET",
        "/api/v1/email-engine/queue?status_filter=not-a-delivery-state",
        token=api_client.access_token(org_admin_role),
        expected_status=422,
    )
    assert_error_envelope(payload)


@pytest.mark.xfail(
    strict=True,
    reason="BR-15 gap: log status filters accept arbitrary strings instead of a lifecycle allowlist",
)
@pytest.mark.parametrize("query", ["statusFilter=unknown", "statusFilters=sent&statusFilters=unknown"])
def test_br_15_log_status_filters_reject_unknown_lifecycle_values(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    query: str,
):
    payload = api_client.request(
        "GET",
        f"/api/v1/email-engine/logs?{query}",
        token=api_client.access_token(org_admin_role),
        expected_status=422,
    )
    assert_error_envelope(payload)
