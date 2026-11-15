# encoding:utf-8
"""agent/tools/browser/browser_service.py's capture_frame/current_page_info:
the two methods backing the web console's live Browser View
(channel/web/api/browser_view.py). BrowserService's constructor only reads
config -- no real Playwright/browser needed to test these wrappers."""

from unittest.mock import MagicMock, patch

from agent.tools.browser.browser_service import BrowserService


def _service():
    return BrowserService({})


def test_capture_frame_returns_none_when_not_running():
    service = _service()
    with patch.object(BrowserService, "is_running", return_value=False):
        assert service.capture_frame() is None


def test_capture_frame_submits_to_the_background_thread_when_running():
    service = _service()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", return_value=b"jpeg-bytes") as submit:
        result = service.capture_frame(quality=40)
    assert result == b"jpeg-bytes"
    submit.assert_called_once_with(service._do_capture_frame, 40)


def test_capture_frame_swallows_a_submit_timeout():
    service = _service()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", side_effect=TimeoutError("timed out")):
        assert service.capture_frame() is None


def test_do_capture_frame_returns_none_with_no_page():
    service = _service()
    service._page = None
    assert service._do_capture_frame(50) is None


def test_do_capture_frame_returns_jpeg_bytes_from_the_page():
    service = _service()
    service._page = MagicMock()
    service._page.screenshot.return_value = b"raw-jpeg"
    result = service._do_capture_frame(50)
    assert result == b"raw-jpeg"
    service._page.screenshot.assert_called_once_with(type="jpeg", quality=50)


def test_do_capture_frame_returns_none_on_a_page_error():
    service = _service()
    service._page = MagicMock()
    service._page.screenshot.side_effect = RuntimeError("page closed")
    assert service._do_capture_frame(50) is None


def test_current_page_info_returns_none_when_not_running():
    service = _service()
    with patch.object(BrowserService, "is_running", return_value=False):
        assert service.current_page_info() is None


def test_do_current_page_info_returns_url_and_title():
    service = _service()
    service._page = MagicMock()
    service._page.url = "https://example.com"
    service._page.title.return_value = "Example"
    assert service._do_current_page_info() == {"url": "https://example.com", "title": "Example"}


def test_do_current_page_info_returns_none_with_no_page():
    service = _service()
    service._page = None
    assert service._do_current_page_info() is None


# =====================================================================
# Coordinate-based control (click/type/key/scroll) for the Browser View
# panel's bidirectional takeover -- Playwright's own page.mouse/keyboard,
# not raw CDP.
# =====================================================================

def test_click_at_returns_an_error_when_not_running():
    service = _service()
    with patch.object(BrowserService, "is_running", return_value=False):
        result = service.click_at(10, 20)
    assert result["error"]


def test_click_at_calls_page_mouse_click_with_the_given_coordinates():
    service = _service()
    service._page = MagicMock()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", side_effect=lambda fn, *a: fn(*a)):
        result = service.click_at(15.5, 42.0)
    service._page.mouse.click.assert_called_once_with(15.5, 42.0)
    assert result["clicked"] is True


def test_type_text_input_calls_page_keyboard_type():
    service = _service()
    service._page = MagicMock()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", side_effect=lambda fn, *a: fn(*a)):
        result = service.type_text_input("hello")
    service._page.keyboard.type.assert_called_once_with("hello")
    assert result["typed"] is True


def test_press_key_input_calls_page_keyboard_press():
    service = _service()
    service._page = MagicMock()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", side_effect=lambda fn, *a: fn(*a)):
        result = service.press_key_input("Enter")
    service._page.keyboard.press.assert_called_once_with("Enter")
    assert result["pressed"] == "Enter"


def test_scroll_by_input_calls_page_mouse_wheel():
    service = _service()
    service._page = MagicMock()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", side_effect=lambda fn, *a: fn(*a)):
        result = service.scroll_by_input(0, 300)
    service._page.mouse.wheel.assert_called_once_with(0, 300)
    assert result["scrolled"] is True


def test_control_methods_swallow_a_submit_timeout():
    service = _service()
    with patch.object(BrowserService, "is_running", return_value=True), \
         patch.object(BrowserService, "_submit", side_effect=TimeoutError("timed out")):
        assert service.click_at(1, 2)["error"]
        assert service.type_text_input("x")["error"]
        assert service.press_key_input("Enter")["error"]
        assert service.scroll_by_input(0, 1)["error"]
