from __future__ import annotations

import pytest

from conftest import (
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
    role_by_slug,
)


pytestmark = pytest.mark.api


@pytest.fixture(scope="module")
def super_admin_role() -> ApiRole:
    return role_by_slug("super-admin")


def test_super_admin_can_list_cron_settings_and_runs(
    api_client: ApiClient,
    super_admin_role: ApiRole,
):
    token = api_client.access_token(super_admin_role)

    settings_payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/settings",
        token=token,
    )
    assert_success_envelope(settings_payload)
    assert isinstance(settings_payload["data"], list)
    assert settings_payload["data"]
    assert {"jobName", "displayName", "enabled", "intervalSeconds"} <= set(
        settings_payload["data"][0].keys()
    )
    assert_camel_case_response(settings_payload)

    runs_payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/runs?page=1&page_size=5",
        token=token,
    )
    assert_success_envelope(runs_payload)
    assert isinstance(runs_payload["data"], list)
    assert "pagination" in runs_payload
    assert_camel_case_response(runs_payload)


def test_super_admin_can_update_and_restore_cron_setting(
    api_client: ApiClient,
    super_admin_role: ApiRole,
):
    token = api_client.access_token(super_admin_role)
    settings_payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/settings",
        token=token,
    )
    assert_success_envelope(settings_payload)
    original = settings_payload["data"][0]
    job_name = original["jobName"]
    restored_body = {
        "enabled": original["enabled"],
        "intervalSeconds": original["intervalSeconds"],
    }

    try:
        updated_payload = api_client.request(
            "PATCH",
            f"/api/v1/cron-jobs/settings/{job_name}",
            json_body={
                "enabled": not original["enabled"],
                "intervalSeconds": max(60, int(original["intervalSeconds"])),
            },
            token=token,
        )
        assert_success_envelope(updated_payload)
        assert updated_payload["data"]["jobName"] == job_name
        assert updated_payload["data"]["enabled"] is (not original["enabled"])
        assert_camel_case_response(updated_payload)
    finally:
        restore_payload = api_client.request(
            "PATCH",
            f"/api/v1/cron-jobs/settings/{job_name}",
            json_body=restored_body,
            token=token,
        )
        assert_success_envelope(restore_payload)


def test_cron_setting_update_requires_update_fields(
    api_client: ApiClient,
    super_admin_role: ApiRole,
):
    token = api_client.access_token(super_admin_role)
    settings_payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/settings",
        token=token,
    )
    assert_success_envelope(settings_payload)
    job_name = settings_payload["data"][0]["jobName"]

    payload = api_client.request(
        "PATCH",
        f"/api/v1/cron-jobs/settings/{job_name}",
        json_body={},
        token=token,
        expected_status=422,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)


def test_cron_job_routes_reject_org_admin(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    token = api_client.access_token(org_admin_role)

    payload = api_client.request(
        "GET",
        "/api/v1/cron-jobs/settings",
        token=token,
        expected_status=403,
    )

    assert_error_envelope(payload)
    assert_camel_case_response(payload)
