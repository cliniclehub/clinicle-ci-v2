"""Unit tests for app.common.json_utils."""

from datetime import date, datetime, timezone
from uuid import UUID

from app.common.json_utils import json_safe_value


def test_json_safe_value_primitives_passthrough():
    assert json_safe_value(None) is None
    assert json_safe_value("a") == "a"
    assert json_safe_value(1) == 1
    assert json_safe_value(1.5) == 1.5
    assert json_safe_value(True) is True


def test_json_safe_value_uuid_and_dates():
    uid = UUID("12345678-1234-5678-1234-567812345678")
    assert json_safe_value(uid) == str(uid)
    assert json_safe_value(date(2026, 7, 30)) == "2026-07-30"
    dt = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    assert json_safe_value(dt) == dt.isoformat()


def test_json_safe_value_nested_containers():
    uid = UUID("12345678-1234-5678-1234-567812345678")
    result = json_safe_value(
        {
            "id": uid,
            "tags": {"a", "b"},
            "items": (date(2026, 1, 1), {"nested": uid}),
        }
    )
    assert result["id"] == str(uid)
    assert sorted(result["tags"]) == ["a", "b"]
    assert result["items"][0] == "2026-01-01"
    assert result["items"][1]["nested"] == str(uid)


def test_json_safe_value_unknown_object_passthrough():
    obj = object()
    assert json_safe_value(obj) is obj
