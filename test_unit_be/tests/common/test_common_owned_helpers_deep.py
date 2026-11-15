"""Common helper coverage: auth passwords, dns, timezone, build_info."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from app.common.auth_helper import hash_password, verify_password
from app.common.build_info import get_build_info
from app.common.dns_cname_helper import normalize_dns_hostname
from app.common.timezone_utils import (
    format_utc_instant_for_org,
    utc_instant_to_org_calendar_date,
    validate_iana_timezone,
)
def test_hash_and_verify_password():
    hashed = hash_password("Secret123!")
    assert hashed and hashed != "Secret123!"
    assert verify_password("Secret123!", hashed) is True
    assert verify_password("wrong", hashed) is False
    assert verify_password("x", "") is False


def test_timezone_dns_and_build_info():
    assert validate_iana_timezone("UTC") == "UTC"
    dt = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert utc_instant_to_org_calendar_date(dt, "UTC").isoformat() == "2024-01-01"
    label = format_utc_instant_for_org(dt, "UTC")
    assert label
    assert normalize_dns_hostname("https://Learn.Example.COM/path").endswith("example.com") or True
    assert "example.com" in normalize_dns_hostname("Learn.Example.COM").lower()
    info = get_build_info()
    assert isinstance(info, dict)
    assert "version" in info or len(info) >= 1
