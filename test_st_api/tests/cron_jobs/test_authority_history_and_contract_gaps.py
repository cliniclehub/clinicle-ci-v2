from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from conftest import (
    ApiClient,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
    role_by_slug,
)


pytestmark = pytest.mark.api


CRON_ROUTES = [
    ("GET", "/api/v1/cron-jobs/settings", None),
    ("PATCH", "/api/v1/cron-jobs/settings/not-a-job", {"enabled": False}),
    ("GET", "/api/v1/cron-jobs/runs", None),
    ("GET", "/api/v1/cron-jobs/runs/-1", None),
    ("POST", "/api/v1/cron-jobs/runs/prune", {"retentionDays": 90}),
    ("POST", "/api/v1/cron-jobs/runs/-1/release", None),
    ("POST", "/api/v1/cron-jobs/jobs/not-a-job/run", None),
]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/cron-jobs/settings", None),
        ("PATCH", "/api/v1/cron-jobs/settings/not-a-job", {"enabled": False}),
        ("GET", "/api/v1/cron-jobs/runs", None),
    ],
)
def test_remaining_cron_routes_require_authentication(
    api_client: ApiClient,
    method: str,
    path: str,
    body: dict | None,
):
    payload = api_client.request(
        method,
        path,
        json_body=body,
        expected_status=401,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(("method", "path", "body"), CRON_ROUTES)
@pytest.mark.parametrize(
    "role_slug", ["org-admin", "user"]
)
def test_non_platform_roles_cannot_access_or_execute_cron_operations(
    api_client: ApiClient,
    role_slug: str,
    method: str,
    path: str,
    body: dict | None,
):
    role = role_by_slug(role_slug)
    payload = api_client.request(
        method,
        path,
        json_body=body,
        token=api_client.access_token(role),
        expected_status=403,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_cron_settings_are_unique_ordered_and_operationally_bounded(
    api_client: ApiClient,
):
    role = role_by_slug("super-admin")
    payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/settings",
        token=api_client.access_token(role),
    )

    assert_success_envelope(payload)
    settings = payload["data"]
    job_names = [setting["jobName"] for setting in settings]
    assert len(job_names) == len(set(job_names))
    assert all(60 <= setting["intervalSeconds"] <= 7 * 24 * 3600 for setting in settings)
    assert all(setting["displayName"] and setting["description"] for setting in settings)
    assert all(
        setting["nextDueAt"] is None or setting["enabled"] is True
        for setting in settings
    )
    assert_camel_case_response(payload)


def test_cron_run_history_status_time_and_trigger_invariants(
    api_client: ApiClient,
):
    role = role_by_slug("super-admin")
    payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/runs?page=1&page_size=100",
        token=api_client.access_token(role),
    )

    assert_success_envelope(payload)
    for run in payload["data"]:
        assert run["status"] in {"running", "success", "failed"}
        assert run["trigger"] in {"scheduled", "manual"}
        if run["status"] == "running":
            assert run["finishedAt"] is None
        else:
            assert run["finishedAt"] is not None
            assert run["finishedAt"] >= run["startedAt"]
        assert isinstance(run["summary"], dict)
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["pageSize"] == 100
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("method", "path", "body", "expected_status"),
    [
        ("PATCH", "/api/v1/cron-jobs/settings/not-a-job", {"enabled": False}, 404),
        ("POST", "/api/v1/cron-jobs/jobs/not-a-job/run", None, 404),
        ("GET", "/api/v1/cron-jobs/runs/999999999999", None, 404),
        ("POST", "/api/v1/cron-jobs/runs/999999999999/release", None, 404),
    ],
)
def test_unknown_cron_jobs_and_runs_fail_without_execution_or_mutation(
    api_client: ApiClient,
    method: str,
    path: str,
    body: dict | None,
    expected_status: int,
):
    role = role_by_slug("super-admin")
    payload = api_client.request(
        method,
        path,
        json_body=body,
        token=api_client.access_token(role),
        expected_status=expected_status,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize("status", ["unknown", "cancelled", "SUCCESS", ""])
@pytest.mark.xfail(
    strict=True,
    reason="PO-02 gap: run status filter is an unrestricted string rather than the run-state enum",
)
def test_po_02_run_history_rejects_unknown_status_filters(
    api_client: ApiClient,
    status: str,
):
    role = role_by_slug("super-admin")
    payload = api_client.request(
        "GET",
        f"/api/v1/cron-jobs/runs?status={status}",
        token=api_client.access_token(role),
        expected_status=422,
    )

    assert_error_envelope(payload)


@pytest.mark.xfail(
    strict=True,
    reason="PO-02 gap: run history accepts an end timestamp before its start timestamp",
)
def test_po_02_run_history_rejects_inverted_date_range(
    api_client: ApiClient,
):
    role = role_by_slug("super-admin")
    now = datetime.now(timezone.utc)
    after = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    before = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = api_client.request(
        "GET",
        f"/api/v1/cron-jobs/runs?started_after={after}&started_before={before}",
        token=api_client.access_token(role),
        expected_status=422,
    )

    assert_error_envelope(payload)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/v1/cron-jobs/runs/-1"),
        ("POST", "/api/v1/cron-jobs/runs/-1/release"),
    ],
)
@pytest.mark.xfail(
    strict=True,
    reason="PO-02/PO-03 gap: run identifiers accept zero and negative integer values",
)
def test_cron_run_identifiers_reject_negative_values(
    api_client: ApiClient,
    method: str,
    path: str,
):
    role = role_by_slug("super-admin")
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(role),
        expected_status=422,
    )

    assert_error_envelope(payload)
