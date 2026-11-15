# encoding:utf-8
"""Frontend wiring for the Browser View's bidirectional takeover (click/
type/scroll on the live page via channel/web/api/browser_view.py's
BrowserControlHandler). Off by default -- the operator arms it explicitly
with the "Take control" toggle."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def _js():
    return (ROOT / "channel/web/static/js/views/browser-view.js").read_text(encoding="utf-8")


def _html():
    return (ROOT / "channel/web/templates/views/browser-view.html").read_text(encoding="utf-8")


def _css():
    return (ROOT / "channel/web/static/css/browser-view.css").read_text(encoding="utf-8")


def test_control_is_off_by_default():
    js = _js()
    assert "let _bvControlling = false;" in js


def test_take_control_button_and_control_bar_exist_in_the_dom():
    html = _html()
    assert 'id="bv-control-toggle"' in html
    assert 'onclick="bvToggleControl()"' in html
    assert 'id="bv-control-bar"' in html
    assert 'id="bv-control-input"' in html


def test_clicking_the_frame_maps_display_coordinates_to_natural_image_space():
    """The frame image can be CSS-scaled; a click must be converted back to
    the actual screenshot pixel space (img.naturalWidth/Height) before
    being sent, or clicks land on the wrong element once the window isn't
    exactly the browser's own viewport size."""
    js = _js()
    assert "img.naturalWidth / rect.width" in js
    assert "action: 'click'" in js


def test_wheel_events_are_forwarded_as_scroll_and_prevent_default():
    """preventDefault matters here specifically: without it, scrolling over
    the live frame would scroll the CONSOLE page itself instead of (or as
    well as) the remote page."""
    js = _js()
    assert "e.preventDefault()" in js
    assert "action: 'scroll'" in js


def test_enter_key_sends_typed_text_then_an_enter_keypress():
    js = _js()
    assert "function bvHandleKeydown(event)" in js
    assert "action: 'type'" in js
    assert "bvSendKey('Enter')" in js


def test_leaving_the_page_always_drops_control():
    """Regression guard: an armed takeover must never survive navigating
    away from the one page that shows what it's doing."""
    js = _js()
    stop_fn = js.split("function stopBrowserViewPolling()")[1].split("function ")[0]
    assert "bvToggleControl()" in stop_fn


def test_control_mode_has_a_visible_style_distinction():
    css = _css()
    assert ".bv-control-toggle.active" in css
    assert ".bv-controlling" in css
