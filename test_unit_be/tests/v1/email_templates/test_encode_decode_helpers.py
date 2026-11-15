"""Unit tests for EmailTemplateService encode/decode helpers."""

import json

from app.v1.email_templates.services import EmailTemplateService


def test_encode_json_text_fields_dumps_objects_and_normalizes_fields():
    encoded = EmailTemplateService._encode_json_text_fields(
        {
            "available_fields": ["firstName", "lastName"],
            "preview_data": {"firstName": "A"},
            "subject": "Hi",
        }
    )
    assert isinstance(encoded["available_fields"], str)
    assert json.loads(encoded["available_fields"]) == [
        {"field": "firstName"},
        {"field": "lastName"},
    ]
    assert json.loads(encoded["preview_data"]) == {"firstName": "A"}
    assert encoded["subject"] == "Hi"


def test_encode_json_text_fields_leaves_none():
    encoded = EmailTemplateService._encode_json_text_fields(
        {"available_fields": None, "preview_data": None}
    )
    assert encoded["available_fields"] is None
    assert encoded["preview_data"] is None


def test_decode_json_text_variants():
    assert EmailTemplateService._decode_json_text(None, fallback=[]) == []
    assert EmailTemplateService._decode_json_text({"a": 1}) == {"a": 1}
    assert EmailTemplateService._decode_json_text('{"a": 1}') == {"a": 1}
    assert EmailTemplateService._decode_json_text("not-json", fallback="x") == "x"


def test_normalize_available_fields_edge_cases():
    assert EmailTemplateService._normalize_available_fields(None) is None
    assert EmailTemplateService._normalize_available_fields("x") is None
    assert EmailTemplateService._normalize_available_fields([]) is None
    assert EmailTemplateService._normalize_available_fields(["", "  "]) is None
    assert EmailTemplateService._normalize_available_fields([" name "]) == [
        {"field": "name"}
    ]
