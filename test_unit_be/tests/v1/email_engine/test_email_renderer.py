"""Unit tests for EmailRenderer Jinja rendering (no DB template fetch)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.common.business_exceptions import BadRequestError, NotFoundError
from app.v1.email_engine.email_renderer import EmailRenderer


def test_render_email_requires_template_key_or_data():
    renderer = EmailRenderer(MagicMock())
    with pytest.raises(BadRequestError, match="template_key or template_data"):
        renderer.render_email()


def test_render_email_rejects_both_key_and_data():
    renderer = EmailRenderer(MagicMock())
    with pytest.raises(BadRequestError, match="Cannot provide both"):
        renderer.render_email(
            template_key="welcome",
            template_data={"subject": "Hi"},
        )


def test_render_email_with_template_data_and_variables():
    renderer = EmailRenderer(MagicMock())
    result = renderer.render_email(
        template_data={
            "subject": "Hello {{ firstName }}",
            "bodyHtml": "<p>{{ firstName }}</p>",
            "bodyText": "Hi {{ firstName }}",
        },
        template_variables={"firstName": "Ammar"},
    )
    assert result["subject"] == "Hello Ammar"
    assert result["bodyHtml"] == "<p>Ammar</p>"
    assert result["bodyText"] == "Hi Ammar"


def test_render_email_empty_body_text_becomes_none():
    renderer = EmailRenderer(MagicMock())
    result = renderer.render_email(
        template_data={"subject": "S", "bodyHtml": "<p>x</p>"},
        template_variables={},
    )
    assert result["bodyText"] is None


def test_render_template_syntax_error():
    renderer = EmailRenderer(MagicMock())
    with pytest.raises(BadRequestError, match="syntax"):
        renderer._render_template("{% if %}", {})


def test_render_template_empty_content():
    renderer = EmailRenderer(MagicMock())
    assert renderer._render_template("", {"a": 1}) == ""


def test_get_template_by_key_not_found():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    renderer = EmailRenderer(db)
    with pytest.raises(NotFoundError, match="not found"):
        renderer._get_template_by_key("missing")


def test_get_template_by_key_returns_fields():
    template = SimpleNamespace(
        subject="Subj",
        body_html="<b>Hi</b>",
        body_text="Hi",
    )
    db = MagicMock()
    query = MagicMock()
    db.query.return_value.filter.return_value = query
    query.filter.return_value.first.return_value = template
    query.first.return_value = template

    renderer = EmailRenderer(db)
    data = renderer._get_template_by_key("welcome")
    assert data == {"subject": "Subj", "bodyHtml": "<b>Hi</b>", "bodyText": "Hi"}
