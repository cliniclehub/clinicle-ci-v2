"""Unit tests for EmailEngineService JSON normalization and reply-to helpers."""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from app.v1.email_engine.services import EmailEngineService


def test_normalize_json_object_none_and_dict():
    assert EmailEngineService._normalize_json_object(None) is None
    payload = {"a": 1}
    assert EmailEngineService._normalize_json_object(payload) == payload


def test_normalize_json_object_stringifies_uuid():
    from uuid import uuid4

    uid = uuid4()
    assert EmailEngineService._normalize_json_object({"userId": uid}) == {"userId": str(uid)}


def test_normalize_json_object_parses_json_string():
    assert EmailEngineService._normalize_json_object('{"x": 2}') == {"x": 2}


def test_normalize_json_object_rejects_non_object_json_and_garbage():
    assert EmailEngineService._normalize_json_object("[1,2]") is None
    assert EmailEngineService._normalize_json_object("not-json") is None
    assert EmailEngineService._normalize_json_object(123) is None


def test_resolve_reply_to_prefers_explicit():
    service = EmailEngineService(MagicMock())
    result = service._resolve_reply_to(
        "  support@example.com ",
        "org@example.com",
    )
    assert result == "support@example.com"


def test_resolve_reply_to_falls_back_to_org_default():
    service = EmailEngineService(MagicMock())
    result = service._resolve_reply_to(
        None,
        "org@example.com",
    )
    assert result == "org@example.com"


def test_get_organization_email_config_defaults_when_missing():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    service = EmailEngineService(db)
    cfg = service._get_organization_email_config(uuid4())
    assert cfg["from_name"] == "Platform"
    assert cfg["reply_to"] == "noreply@example.com"


def test_get_organization_email_config_uses_org_admin_email():
    org = SimpleNamespace(name="Acme", admin_email="admin@example.com")
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = org
    service = EmailEngineService(db)
    cfg = service._get_organization_email_config(uuid4())
    assert cfg["from_name"] == "Acme"
    assert cfg["reply_to"] == "admin@example.com"
