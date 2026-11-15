import pytest

from app.v1.email_templates.services import EmailTemplateService


@pytest.mark.unit
def test_normalize_available_fields_accepts_string_list():
    result = EmailTemplateService._normalize_available_fields(
        ["firstName", "offeringTitle"]
    )

    assert result == [{"field": "firstName"}, {"field": "offeringTitle"}]


@pytest.mark.unit
def test_normalize_available_fields_preserves_dict_rows():
    rows = [{"field": "firstName", "description": "Student first name"}]
    assert EmailTemplateService._normalize_available_fields(rows) == rows
