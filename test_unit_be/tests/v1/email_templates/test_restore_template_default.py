"""Tests for EmailTemplateService restore-to-default."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.v1.email_templates.services import EmailTemplateService


def _make_service(db):
    svc = EmailTemplateService.__new__(EmailTemplateService)
    svc.db = db
    return svc


def test_resolve_restore_template_key_uses_template_key_when_in_defaults():
    svc = _make_service(SimpleNamespace())
    template = SimpleNamespace(
        template_key="registration-welcome",
        category="system",
    )
    assert svc._resolve_restore_template_key(template) == "registration-welcome"


def test_resolve_restore_template_key_rejects_unknown_key():
    svc = _make_service(SimpleNamespace())
    template = SimpleNamespace(
        template_key=str(uuid4()),
        category="system",
    )
    with pytest.raises(HTTPException) as exc_info:
        svc._resolve_restore_template_key(template)
    assert exc_info.value.status_code == 400


def test_resolve_restore_template_key_rejects_unknown_custom_template():
    svc = _make_service(SimpleNamespace())
    template = SimpleNamespace(
        template_key="my-custom-marketing-blast",
        category="general",
    )
    with pytest.raises(HTTPException) as exc_info:
        svc._resolve_restore_template_key(template)
    assert exc_info.value.status_code == 400


def test_default_templates_are_the_four_auth_keys():
    keys = {
        t["template_key"]
        for t in EmailTemplateService._load_default_templates()
    }
    assert keys == {
        "email-verification",
        "password-reset",
        "password-changed",
        "registration-welcome",
    }
