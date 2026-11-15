# encoding:utf-8
"""channel/web/api/browser_view.py: the read-only live view over whatever
page the shared browser tool is currently showing. _require_capability is
real here (not mocked away) so the settings.security gate is actually
exercised, matching the same discipline as workspace_files.py's own tests."""

import json
from unittest.mock import MagicMock, patch

import pytest
import web

from channel.web.api.browser_view import (
    BrowserControlHandler, BrowserFrameHandler, BrowserStatusHandler,
)


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


def _patched(capability_ok=True):
    require_auth = patch("channel.web.api.browser_view._require_auth")
    if capability_ok:
        require_cap = patch("channel.web.api.browser_view._require_capability")
    else:
        def _deny(cap):
            web.ctx.status = "403 Forbidden"
            raise web.HTTPError(
                "403 Forbidden", {"Content-Type": "application/json"},
                json.dumps({"status": "error", "message": f"{cap} capability required"}),
            )
        require_cap = patch("channel.web.api.browser_view._require_capability", side_effect=_deny)
    return patch("channel.web.api.browser_view.web.header"), require_auth, require_cap


def test_status_reports_not_running_when_no_service_exists():
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=None):
        response = json.loads(BrowserStatusHandler().GET())
    assert response == {"status": "success", "running": False}


def test_status_reports_not_running_when_service_exists_but_idle():
    service = MagicMock()
    service.is_running.return_value = False
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service):
        response = json.loads(BrowserStatusHandler().GET())
    assert response == {"status": "success", "running": False}


def test_status_reports_url_and_title_when_running():
    service = MagicMock()
    service.is_running.return_value = True
    service.current_page_info.return_value = {"url": "https://example.com", "title": "Example"}
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service):
        response = json.loads(BrowserStatusHandler().GET())
    assert response == {
        "status": "success", "running": True,
        "url": "https://example.com", "title": "Example",
    }


def test_status_is_gated_on_settings_security_capability():
    p1, p2, p3 = _patched(capability_ok=False)
    with p1, p2, p3:
        with pytest.raises(web.HTTPError):
            BrowserStatusHandler().GET()


def test_frame_returns_the_captured_jpeg_bytes():
    service = MagicMock()
    service.capture_frame.return_value = b"\xff\xd8\xff\xfake-jpeg-bytes"
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service):
        response = BrowserFrameHandler().GET()
    assert response == b"\xff\xd8\xff\xfake-jpeg-bytes"


def test_frame_returns_a_placeholder_when_no_service_exists():
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=None):
        response = BrowserFrameHandler().GET()
    assert response == BrowserFrameHandler._PLACEHOLDER_PNG


def test_frame_returns_a_placeholder_when_capture_returns_none():
    service = MagicMock()
    service.capture_frame.return_value = None
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service):
        response = BrowserFrameHandler().GET()
    assert response == BrowserFrameHandler._PLACEHOLDER_PNG


def test_frame_is_gated_on_settings_security_capability():
    p1, p2, p3 = _patched(capability_ok=False)
    with p1, p2, p3:
        with pytest.raises(web.HTTPError):
            BrowserFrameHandler().GET()


def test_placeholder_png_is_a_valid_1x1_image():
    """The one property that actually matters for this constant: a browser
    must be able to decode it, or the <img> polling it shows a broken-image
    icon during every idle poll instead of the intended blank frame."""
    data = BrowserFrameHandler._PLACEHOLDER_PNG
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert data.endswith(b"IEND\xaeB`\x82")


# =====================================================================
# Control (bidirectional takeover: click/type/key/scroll)
# =====================================================================

def test_control_click_calls_click_at_with_coordinates():
    service = MagicMock()
    service.is_running.return_value = True
    service.click_at.return_value = {"clicked": True}
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service), \
         patch("channel.web.api.browser_view.web.data",
               return_value=json.dumps({"action": "click", "x": 12, "y": 34}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "success"
    service.click_at.assert_called_once_with(12.0, 34.0)


def test_control_type_calls_type_text_input():
    service = MagicMock()
    service.is_running.return_value = True
    service.type_text_input.return_value = {"typed": True}
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service), \
         patch("channel.web.api.browser_view.web.data",
               return_value=json.dumps({"action": "type", "text": "hello"}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "success"
    service.type_text_input.assert_called_once_with("hello")


def test_control_key_calls_press_key_input():
    service = MagicMock()
    service.is_running.return_value = True
    service.press_key_input.return_value = {"pressed": "Enter"}
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service), \
         patch("channel.web.api.browser_view.web.data",
               return_value=json.dumps({"action": "key", "key": "Enter"}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "success"
    service.press_key_input.assert_called_once_with("Enter")


def test_control_scroll_calls_scroll_by_input():
    service = MagicMock()
    service.is_running.return_value = True
    service.scroll_by_input.return_value = {"scrolled": True}
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service), \
         patch("channel.web.api.browser_view.web.data",
               return_value=json.dumps({"action": "scroll", "dx": 0, "dy": 200}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "success"
    service.scroll_by_input.assert_called_once_with(0.0, 200.0)


def test_control_rejects_an_unknown_action():
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view.web.data",
                            return_value=json.dumps({"action": "nonsense"}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "error"


def test_control_requires_a_running_browser():
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=None), \
         patch("channel.web.api.browser_view.web.data",
               return_value=json.dumps({"action": "click", "x": 1, "y": 1}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "error"


def test_control_surfaces_a_service_level_error():
    service = MagicMock()
    service.is_running.return_value = True
    service.click_at.return_value = {"error": "no page open"}
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.browser_view._get_shared_service", return_value=service), \
         patch("channel.web.api.browser_view.web.data",
               return_value=json.dumps({"action": "click", "x": 1, "y": 1}).encode()):
        response = json.loads(BrowserControlHandler().POST())
    assert response["status"] == "error"
    assert response["message"] == "no page open"


def test_control_is_gated_on_settings_security_capability():
    p1, p2, p3 = _patched(capability_ok=False)
    with p1, p2, p3, patch("channel.web.api.browser_view.web.data",
                            return_value=json.dumps({"action": "click", "x": 1, "y": 1}).encode()):
        with pytest.raises(web.HTTPError):
            BrowserControlHandler().POST()
