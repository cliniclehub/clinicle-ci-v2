"""EmailEngineService pure helper coverage (Clinicle)."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.v1.email_engine.services import EmailEngineService, _is_dry_run_provider_result


def test_json_safe_coerce_and_normalize():
    uid = uuid4()
    now = datetime.now(timezone.utc)
    assert EmailEngineService._json_safe(uid) == str(uid)
    assert EmailEngineService._json_safe(now) == now.isoformat()
    assert EmailEngineService._json_safe({"u": uid, "n": now, "l": [uid]})["u"] == str(uid)
    assert EmailEngineService._coerce_user_id(None) is None
    assert EmailEngineService._coerce_user_id("") is None
    assert EmailEngineService._coerce_user_id(uid) == uid
    assert EmailEngineService._coerce_user_id(str(uid)) == uid

    assert EmailEngineService._normalize_json_object(None) is None
    assert EmailEngineService._normalize_json_object({"a": 1}) == {"a": 1}
    assert EmailEngineService._normalize_json_object('{"a": 1}') == {"a": 1}
    assert EmailEngineService._normalize_json_object("not-json") is None
    assert EmailEngineService._normalize_json_object("[1]") is None
    assert EmailEngineService._normalize_json_object(12) is None


def test_is_dry_run_provider_result():
    assert _is_dry_run_provider_result(
        SimpleNamespace(provider_response={"dry_run": True})
    ) is True
    assert _is_dry_run_provider_result(
        SimpleNamespace(provider_response={"dry_run": False})
    ) is False
    assert _is_dry_run_provider_result(SimpleNamespace(provider_response=None)) is False


def test_record_blocked_placeholder_email_log():
    db = MagicMock()
    svc = EmailEngineService(db)
    with patch(
        "app.v1.email_engine.services.EmailLog",
        side_effect=lambda **kw: SimpleNamespace(**kw),
    ):
        log = svc._record_blocked_placeholder_email_log(
            email="x@internal.invalid",
            organization_id=uuid4(),
            template_key="t",
            subject="S",
            body_html="<p>x</p>",
            from_name="Org",
            from_email="noreply@example.com",
            reply_to=None,
            template_data={"a": 1},
            user_id=None,
            priority=1,
        )
        assert log.status == "blocked"
        db.add.assert_called()


def test_prepare_and_org_variables():
    db = MagicMock()
    svc = EmailEngineService(db)
    org_id = uuid4()
    with patch.object(
        svc, "_get_organization_variables", return_value={"organizationName": "Acme"}
    ), patch.object(
        svc,
        "_get_organization_email_config",
        return_value={"from_name": "Acme", "from_email": "a@b.c", "reply_to": "r@b.c"},
    ):
        vars_ = svc._prepare_template_variables(
            organization_id=org_id,
            custom_variables={"extra": True},
        )
        assert vars_["organizationName"] == "Acme"
        assert vars_["replyToEmail"] == "r@b.c"
        assert vars_["extra"] is True

    org = SimpleNamespace(
        id=org_id,
        name="Acme",
        domain="acme.test",
        admin_email="admin@acme.test",
    )
    q = MagicMock()
    q.filter.return_value = q
    q.first.return_value = org
    db.query.return_value = q
    org_vars = svc._get_organization_variables(org_id)
    assert org_vars["organizationName"] == "Acme"
    assert org_vars["organizationUrl"] == "https://acme.test"
    cfg = svc._get_organization_email_config(org_id)
    assert cfg["reply_to"] == "admin@acme.test"
