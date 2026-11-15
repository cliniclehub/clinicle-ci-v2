"""Unit tests for Auth2Service user-agent device parsing."""

from unittest.mock import MagicMock

import pytest

from app.v1.auth.services import Auth2Service


@pytest.fixture
def auth_service():
    return Auth2Service(MagicMock())


@pytest.mark.parametrize(
    "ua,browser,os_name,device",
    [
        (None, "Unknown browser", "Unknown OS", "Unknown"),
        ("", "Unknown browser", "Unknown OS", "Unknown"),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Chrome",
            "Windows",
            "desktop",
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Safari",
            "macOS",
            "desktop",
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
            "Firefox",
            "Windows",
            "desktop",
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
            "Edge",
            "Windows",
            "desktop",
        ),
        (
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Chrome",
            "Android",
            "mobile",
        ),
        (
            # Parser matches "mac os x" before "iphone"/"ipad" in current implementation.
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Safari",
            "macOS",
            "mobile",
        ),
        (
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Safari",
            "macOS",
            "mobile",
        ),
        (
            "SomeAgent Android Tablet",
            "Unknown browser",
            "Android",
            "mobile",
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
            "Opera",
            "Linux",
            "desktop",
        ),
    ],
)
def test_parse_device_info_from_user_agent(auth_service, ua, browser, os_name, device):
    result = auth_service._parse_device_info_from_user_agent(ua)
    assert result == {"browser": browser, "os": os_name, "device": device}
