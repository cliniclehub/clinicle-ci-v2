"""Common helper coverage: filter parser, timezone, dns, http errors, api responses."""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.common.api_response_schema import (
    error_response,
    paginated_response,
    process_pydantic_errors,
    success_response,
    validation_error_response,
)
from app.common.business_exceptions import (
    AuthenticationError,
    AuthorizationError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PaymentRequiredError,
    RateLimitError,
    ResourceExpiredError,
    ServiceUnavailableError,
    ValidationError,
)
from app.common.dns_cname_helper import normalize_dns_hostname, query_cname_target
from app.common.filter_parser import FilterParser
from app.common.http_errors import to_http_exception
from app.common.timezone_utils import (
    format_session_window_for_org,
    format_utc_instant_for_org,
    inclusive_date_window_to_utc,
    utc_instant_to_org_calendar_date,
    validate_iana_timezone,
)
def test_filter_parser_parse_and_validate():
    with pytest.raises(BadRequestError):
        FilterParser.parse_filters("{bad")
    filters = {
        "groupLogic": "AND",
        "groups": [
            {
                "logic": "OR",
                "conditions": [
                    {"field": "name", "operator": "contains", "value": "a", "type": "text"},
                    {"field": "age", "operator": "greater_than", "value": "10", "type": "number"},
                    {"field": "active", "operator": "equals", "value": "true", "type": "boolean"},
                    {"field": "status", "operator": "in", "value": ["a", "b"], "type": "multiselect"},
                    {"field": "x", "operator": "is_null", "value": None, "type": "text"},
                ],
            }
        ],
    }
    FilterParser.validate_filter_structure(filters)
    with pytest.raises(BadRequestError):
        FilterParser.validate_filter_structure({"groups": []})
    with pytest.raises(BadRequestError):
        FilterParser.validate_filter_structure(
            {"groups": [{"conditions": [], "logic": "XOR"}], "groupLogic": "AND"}
        )


def test_filter_parser_convert_and_build():
    assert FilterParser.convert_value("1.5", "number") == 1.5
    assert FilterParser.convert_value("true", "boolean") is True
    assert FilterParser.convert_value("2020-01-02", "date") == date(2020, 1, 2)
    col = MagicMock()
    col.__eq__ = MagicMock(return_value="eq")
    col.ilike = MagicMock(return_value="ilike")
    col.is_ = MagicMock(return_value="isnull")
    mapping = {"name": col}
    cond = FilterParser.build_condition(
        None, mapping, {"field": "name", "operator": "contains", "value": "x", "type": "text"}
    )
    assert cond == "ilike"
    assert (
        FilterParser.build_condition(
            None, mapping, {"field": None, "operator": "equals", "value": 1}
        )
        is None
    )
    with pytest.raises(BadRequestError):
        FilterParser.build_condition(
            None, mapping, {"field": "missing", "operator": "equals", "value": 1}
        )
    with pytest.raises(BadRequestError):
        FilterParser.build_condition(
            None, mapping, {"field": "name", "operator": "nope", "value": 1}
        )

    special = {"name": lambda op, val, ft: "SPECIAL"}
    assert (
        FilterParser.build_condition(
            None,
            mapping,
            {"field": "name", "operator": "equals", "value": "x"},
            special_handlers=special,
        )
        == "SPECIAL"
    )


def test_filter_parser_apply_filters():
    from sqlalchemy.sql.elements import ColumnElement

    query = MagicMock()
    query.filter.return_value = query
    clause = MagicMock(spec=ColumnElement)
    col = MagicMock()
    col.ilike = MagicMock(return_value=clause)
    filters = {
        "groupLogic": "OR",
        "groups": [
            {
                "logic": "AND",
                "conditions": [
                    {"field": "name", "operator": "contains", "value": "a", "type": "text"}
                ],
            }
        ],
    }
    import json

    with patch("app.common.filter_parser.or_", return_value=clause), patch(
        "app.common.filter_parser.and_", return_value=clause
    ):
        out = FilterParser.apply_filters(
            query, None, {"name": col}, json.dumps(filters)
        )
    assert out is query
    query.filter.assert_called()


def test_timezone_utils():
    assert validate_iana_timezone("UTC") == "UTC"
    with pytest.raises(ValueError):
        validate_iana_timezone("")
    with pytest.raises(ValueError):
        validate_iana_timezone("Not/AZone")

    start, end = inclusive_date_window_to_utc(date(2024, 1, 1), date(2024, 1, 2), "UTC")
    assert start.tzinfo == timezone.utc
    assert end > start

    dt = datetime(2024, 6, 1, 15, 30, tzinfo=timezone.utc)
    assert "2024" in format_utc_instant_for_org(dt, "UTC")
    assert "at" in format_utc_instant_for_org(dt, "UTC", include_time=True)
    assert format_utc_instant_for_org(None) == ""

    window = format_session_window_for_org(dt, dt.replace(hour=17), "UTC")
    assert "–" in window or "-" in window
    assert format_session_window_for_org(None, None) == ""
    assert format_session_window_for_org(dt, None, "UTC")

    assert utc_instant_to_org_calendar_date(dt, "UTC") == date(2024, 6, 1)
    assert utc_instant_to_org_calendar_date(None, "UTC") is None


def test_dns_normalize_and_query_fallbacks():
    assert normalize_dns_hostname(" Example.COM. ") == "example.com"
    assert query_cname_target("") is None
    with patch(
        "dns.resolver.Resolver"
    ) as resolver_cls:
        resolver = MagicMock()
        resolver_cls.return_value = resolver
        resolver.resolve.return_value = [SimpleNamespace(target="cdn.example.com.")]
        assert query_cname_target("www.example.com") == "cdn.example.com"


def test_to_http_exception_mapping():
    assert to_http_exception(NotFoundError("x")).status_code == 404
    assert to_http_exception(ConflictError("x")).status_code == 409
    assert to_http_exception(AuthenticationError("x")).status_code == 401
    assert to_http_exception(ForbiddenError("x")).status_code == 403
    assert to_http_exception(AuthorizationError("x")).status_code == 403
    assert to_http_exception(ValidationError("x")).status_code == 422
    assert to_http_exception(BadRequestError("x")).status_code == 400
    assert to_http_exception(PaymentRequiredError("x")).status_code == 402
    assert to_http_exception(ResourceExpiredError("x")).status_code == 410
    assert to_http_exception(RateLimitError("x")).status_code == 429
    assert to_http_exception(ServiceUnavailableError("x")).status_code == 503
    # unknown AppError subclass path
    from app.common.business_exceptions import AppError

    assert to_http_exception(AppError("x")).status_code == 500


def test_api_response_helpers():
    ok = success_response({"a": 1}, message="done")
    dumped = ok.model_dump()
    assert dumped["status"] == "success"
    assert "timestamp" in dumped

    err = error_response("boom", "Error", 400, description="d", details={"f": "x"})
    assert err.model_dump()["code"] == 400

    assert process_pydantic_errors(
        [{"loc": ("body", "email"), "msg": "invalid"}]
    ) == {"email": "invalid"}

    verr = validation_error_response(
        details=[{"loc": ("name",), "msg": "required"}]
    )
    assert verr.code == 422
    assert verr.details["name"] == "required"

    page = paginated_response([1, 2], total=20, page=1, limit=10)
    assert page.pagination.page == 1
    assert page.pagination.has_prev_page is False
    assert page.pagination.has_next_page is True
    page2 = paginated_response([1, 2], total=20, page=2, limit=10)
    assert page2.pagination.has_prev_page is True
    assert page2.pagination.has_next_page is False
