from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
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
    user_id_for_email,
)


pytestmark = pytest.mark.api


@pytest.fixture
def notification_preference_users(
    api_db_engine,
    org_domain: str,
    user_2_role: ApiRole,
    user_3_role: ApiRole,
) -> dict[str, str]:
    """Per-user notification preferences are not persisted, so nothing needs restoring."""
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    return {
        "organization_id": organization_id,
        "owner_id": user_id_for_email(api_db_engine, organization_id, user_3_role.email),
        "other_id": user_id_for_email(api_db_engine, organization_id, user_2_role.email),
    }


@pytest.fixture
def disposable_org_notification_settings(api_db_engine, org_domain: str):
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    with api_db_engine.connect() as connection:
        original = connection.execute(
            text(f"SELECT notification_settings FROM {db_table('organizations')} WHERE id = :id"),
            {"id": organization_id},
        ).scalar_one()
    try:
        yield {"organization_id": organization_id}
    finally:
        with api_db_engine.begin() as connection:
            connection.execute(
                text(
                    f"""
                    UPDATE {db_table('organizations')}
                    SET notification_settings = CAST(:settings AS jsonb)
                    WHERE id = :id
                    """
                ),
                {"id": organization_id, "settings": json.dumps(original or {})},
            )


@pytest.fixture
def notification_report_rows(
    api_db_engine,
    org_domain: str,
    user_3_role: ApiRole,
) -> dict[str, str | int]:
    organization_id = organization_id_for_domain(api_db_engine, org_domain)
    user_id = user_id_for_email(api_db_engine, organization_id, user_3_role.email)
    rule_key = f"api_test_rule_{uuid4().hex}"
    source_id = str(uuid4())
    event_at = datetime.now(timezone.utc) + timedelta(days=7)
    fire_at = event_at - timedelta(hours=1)
    with api_db_engine.begin() as connection:
        connection.execute(
            text(
                f"""
                INSERT INTO {db_table('notification_rule_definitions')} (
                    rule_key, display_name, description, category,
                    default_channels, default_offsets_minutes, recipient_role,
                    is_time_based, template_key, is_active
                ) VALUES (
                    :rule_key, 'API disposable rule', 'API reporting evidence',
                    'api_test', '["email"]'::jsonb, '[60]'::jsonb, 'user',
                    true, 'api-disposable-template', true
                )
                """
            ),
            {"rule_key": rule_key},
        )
        schedule_id = connection.execute(
            text(
                f"""
                INSERT INTO {db_table('notification_schedules')} (
                    organization_id, rule_key, fire_at, event_at, source_type,
                    source_id, source_hash, status, schedule_metadata
                ) VALUES (
                    :organization_id, :rule_key, :fire_at, :event_at,
                    'api_test', :source_id, :source_hash, 'pending',
                    '{{"fixture":"pytest-api"}}'::jsonb
                ) RETURNING id
                """
            ),
            {
                "organization_id": organization_id,
                "rule_key": rule_key,
                "fire_at": fire_at,
                "event_at": event_at,
                "source_id": source_id,
                "source_hash": uuid4().hex,
            },
        ).scalar_one()
        delivery_id = connection.execute(
            text(
                f"""
                INSERT INTO {db_table('notification_deliveries')} (
                    organization_id, user_id, rule_key, channel, source_type,
                    source_id, schedule_id, fire_at, status, error_message,
                    delivery_metadata
                ) VALUES (
                    :organization_id, :user_id, :rule_key, 'email', 'api_test',
                    :source_id, :schedule_id, :fire_at, 'failed',
                    'Disposable provider-independent failure',
                    '{{"fixture":"pytest-api"}}'::jsonb
                ) RETURNING id
                """
            ),
            {
                "organization_id": organization_id,
                "user_id": user_id,
                "rule_key": rule_key,
                "source_id": source_id,
                "schedule_id": schedule_id,
                "fire_at": fire_at,
            },
        ).scalar_one()
    context = {
        "organization_id": organization_id,
        "user_id": user_id,
        "rule_key": rule_key,
        "schedule_id": int(schedule_id),
        "delivery_id": int(delivery_id),
    }
    try:
        yield context
    finally:
        with api_db_engine.begin() as connection:
            connection.execute(
                text(f"DELETE FROM {db_table('notification_deliveries')} WHERE id = :id"),
                {"id": context["delivery_id"]},
            )
            connection.execute(
                text(f"DELETE FROM {db_table('notification_schedules')} WHERE id = :id"),
                {"id": context["schedule_id"]},
            )
            connection.execute(
                text(f"DELETE FROM {db_table('notification_rule_definitions')} WHERE rule_key = :key"),
                {"key": context["rule_key"]},
            )


def _org_settings(api_db_engine, organization_id: str) -> dict:
    with api_db_engine.connect() as connection:
        value = connection.execute(
            text(f"SELECT notification_settings FROM {db_table('organizations')} WHERE id = :id"),
            {"id": organization_id},
        ).scalar_one()
    return value or {}


def test_no_04_preferences_are_read_only_defaults(
    api_client: ApiClient,
    user_3_role: ApiRole,
    notification_preference_users: dict[str, str],
):
    """Per-user overrides are no longer stored; reads and writes both yield defaults."""
    token = api_client.access_token(user_3_role)
    defaults = {"emailEnabled": True}

    current = api_client.request(
        "GET", "/api/v1/notifications/preferences/me", token=token
    )
    assert_success_envelope(current)
    assert current["data"] == defaults

    updated = api_client.request(
        "PATCH",
        "/api/v1/notifications/preferences/me",
        json_body={"emailEnabled": False},
        token=token,
    )
    assert_success_envelope(updated)
    assert updated["data"] == defaults
    assert_camel_case_response(updated)

    after = api_client.request(
        "GET", "/api/v1/notifications/preferences/me", token=token
    )
    assert after["data"] == defaults


def test_no_04_preference_validation_failure_is_rejected(
    api_client: ApiClient,
    user_3_role: ApiRole,
    notification_preference_users: dict[str, str],
):
    payload = api_client.request(
        "PATCH",
        "/api/v1/notifications/preferences/me",
        json_body={"emailEnabled": "not-a-boolean"},
        token=api_client.access_token(user_3_role),
        expected_status=422,
    )
    assert_error_envelope(payload)


def test_notification_admin_updates_org_defaults_and_effective_view_repeatably(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    disposable_org_notification_settings: dict[str, str],
    api_db_engine,
):
    organization_id = disposable_org_notification_settings["organization_id"]
    rule_key = f"api_settings_rule_{uuid4().hex[:12]}"
    with api_db_engine.begin() as connection:
        connection.execute(
            text(
                f"""
                INSERT INTO {db_table('notification_rule_definitions')} (
                    rule_key, display_name, description, category,
                    default_channels, default_offsets_minutes, recipient_role,
                    is_time_based, template_key, is_active
                ) VALUES (
                    :rule_key, 'API settings rule', 'Org defaults evidence',
                    'api_test', '["email"]'::jsonb, '[60]'::jsonb, 'user',
                    true, 'api-settings-template', true
                )
                """
            ),
            {"rule_key": rule_key},
        )

    try:
        token = api_client.access_token(org_admin_role)
        body = {
            "enabled": True,
            "inheritOrgDefaults": False,
            "rules": {
                rule_key: {
                    "enabled": False,
                    "channels": ["email"],
                    "offsetsMinutes": [120, 30, 30],
                }
            },
        }
        first = api_client.request(
            "PATCH", "/api/v1/notifications/org-settings", json_body=body, token=token
        )
        second = api_client.request(
            "PATCH", "/api/v1/notifications/org-settings", json_body=body, token=token
        )
        assert_success_envelope(first)
        assert second["data"]["rules"][rule_key]["offsetsMinutes"] == [120, 30]
        assert _org_settings(api_db_engine, organization_id) == second["data"]

        effective = api_client.request(
            "GET", "/api/v1/notifications/effective-settings", token=token
        )
        assert_success_envelope(effective)
        assignment = next(
            item for item in effective["data"]["rules"]
            if item["ruleKey"] == rule_key
        )
        assert assignment["enabled"] is False
        assert assignment["offsetsMinutes"] == [120, 30]
        assert assignment["inheritedFrom"] == "organization"
    finally:
        with api_db_engine.begin() as connection:
            connection.execute(
                text(
                    f"DELETE FROM {db_table('notification_rule_definitions')} WHERE rule_key = :key"
                ),
                {"key": rule_key},
            )


def test_user_cannot_change_org_defaults_and_failure_has_no_write(
    api_client: ApiClient,
    user_role: ApiRole,
    disposable_org_notification_settings: dict[str, str],
    api_db_engine,
):
    organization_id = disposable_org_notification_settings["organization_id"]
    before = _org_settings(api_db_engine, organization_id)
    payload = api_client.request(
        "PATCH",
        "/api/v1/notifications/org-settings",
        json_body={"enabled": False, "inheritOrgDefaults": False, "rules": {}},
        token=api_client.access_token(user_role),
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert _org_settings(api_db_engine, organization_id) == before


def test_notification_admin_filters_exact_schedule_and_delivery_evidence(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    notification_report_rows: dict[str, str | int],
):
    token = api_client.access_token(org_admin_role)
    rule_key = notification_report_rows["rule_key"]
    schedules = api_client.request(
        "GET",
        f"/api/v1/notifications/schedules?ruleKey={rule_key}&status=pending&pageSize=1",
        token=token,
    )
    assert_success_envelope(schedules)
    assert schedules["data"]["total"] == 1
    assert schedules["data"]["page"] == 1
    assert schedules["data"]["pageSize"] == 1
    assert schedules["data"]["items"][0]["id"] == notification_report_rows["schedule_id"]
    assert schedules["data"]["items"][0]["scheduleMetadata"]["fixture"] == "pytest-api"

    deliveries = api_client.request(
        "GET",
        f"/api/v1/notifications/deliveries?ruleKey={rule_key}&status=failed"
        f"&scheduleId={notification_report_rows['schedule_id']}"
        f"&userId={notification_report_rows['user_id']}",
        token=token,
    )
    assert_success_envelope(deliveries)
    assert deliveries["data"]["total"] == 1
    item = deliveries["data"]["items"][0]
    assert item["id"] == notification_report_rows["delivery_id"]
    assert item["status"] == "failed"
    assert item["errorMessage"] == "Disposable provider-independent failure"
    assert_camel_case_response(deliveries)


def test_tenant_b_admin_cannot_observe_tenant_a_schedule_or_delivery(
    api_client: ApiClient,
    tenant_b_org_admin_role: ApiRole,
    notification_report_rows: dict[str, str | int],
):
    token = api_client.access_token(tenant_b_org_admin_role)
    rule_key = notification_report_rows["rule_key"]
    for resource in ("schedules", "deliveries"):
        payload = api_client.request(
            "GET", f"/api/v1/notifications/{resource}?ruleKey={rule_key}", token=token
        )
        assert_success_envelope(payload)
        assert payload["data"]["total"] == 0
        assert payload["data"]["items"] == []


def test_notification_admin_dispatches_provider_independent_missing_offering_to_terminal_skip(
    api_client: ApiClient,
    org_admin_role: ApiRole,
    notification_report_rows: dict[str, str | int],
    api_db_engine,
):
    schedule_id = notification_report_rows["schedule_id"]
    with api_db_engine.begin() as connection:
        connection.execute(
            text(
                f"""
                UPDATE {db_table('notification_schedules')}
                SET fire_at = '1970-01-01 00:00:00+00',
                    event_at = '1970-01-01 01:00:00+00',
                    status = 'pending'
                WHERE id = :id
                """
            ),
            {"id": schedule_id},
        )

    payload = api_client.request(
        "POST",
        "/api/v1/notifications/dispatch-due?limit=1",
        token=api_client.access_token(org_admin_role),
    )
    assert_success_envelope(payload)
    assert payload["data"] == {
        "due_schedules": 1,
        "processed_schedules": 1,
        "sent": 0,
        "skipped": 1,
        "failed": 0,
        "errors": [],
    }
    with api_db_engine.connect() as connection:
        state = connection.execute(
            text(
                f"""
                SELECT status, dispatched_at
                FROM {db_table('notification_schedules')}
                WHERE id = :id
                """
            ),
            {"id": schedule_id},
        ).mappings().one()
    assert state["status"] == "skipped"
    assert state["dispatched_at"] is not None


@pytest.mark.parametrize("role_fixture", ["user"])
def test_non_admin_dispatch_denial_leaves_due_schedule_pending(
    api_client: ApiClient,
    request: pytest.FixtureRequest,
    role_fixture: str,
    notification_report_rows: dict[str, str | int],
    api_db_engine,
):
    role: ApiRole = request.getfixturevalue(f"{role_fixture}_role")
    payload = api_client.request(
        "POST",
        "/api/v1/notifications/dispatch-due?limit=1",
        token=api_client.access_token(role),
        expected_status=403,
    )
    assert_error_envelope(payload)
    with api_db_engine.connect() as connection:
        status = connection.execute(
            text(f"SELECT status FROM {db_table('notification_schedules')} WHERE id = :id"),
            {"id": notification_report_rows["schedule_id"]},
        ).scalar_one()
    assert status == "pending"


@pytest.mark.xfail(
    strict=True,
    reason="NO-01/NO-03/NO-05 product gap: no owner-scoped in-app notification history API",
)
def test_no_01_no_03_no_05_owner_lists_reads_and_dismisses_in_app_notification(
    api_client: ApiClient,
    user_3_role: ApiRole,
):
    payload = api_client.request(
        "GET",
        "/api/v1/notifications/me?readStatus=unread&page=1&pageSize=20",
        token=api_client.access_token(user_3_role),
    )
    assert_success_envelope(payload)


@pytest.mark.xfail(
    strict=True,
    reason="NO-06/NO-07 product gap: no tenant-scoped announcement creation API",
)
def test_no_06_org_admin_creates_targeted_announcement(
    api_client: ApiClient,
    org_admin_role: ApiRole,
):
    payload = api_client.request(
        "POST",
        "/api/v1/notifications/announcements",
        json_body={
            "title": "API contract announcement",
            "content": "Disposable test",
            "targetAudience": "role:user",
            "priority": "normal",
        },
        token=api_client.access_token(org_admin_role),
        expected_status=201,
    )
    assert_success_envelope(payload)
