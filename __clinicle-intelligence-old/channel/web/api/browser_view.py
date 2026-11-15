"""Live Browser View: /api/browser/* -- lets a human watch AND, once they
explicitly take control, drive whatever page the shared browser tool
(agent/tools/browser/) is currently showing. Polled/driven from a dedicated
sidebar page (channel/web/templates/views/browser-view.html) the same way
the Code Editor's own panels poll.

Gated on settings.security like the Code Editor / Worktrees / Pending Edits
pages -- this surfaces (and lets a human act on) live browsing activity for
WHICHEVER agent is currently using the browser tool, not one scoped
conversation's worth.

Known limitation, inherited from the tool itself, not introduced here:
agent/tools/browser/browser_tool.py's `_shared_service` is a single
process-wide singleton (one browser at a time, shared by every Agent and --
in a multi-tenant deployment -- every org in this process). This panel
shows and drives that one shared session; it does not add or remove any
tenant isolation the underlying tool doesn't already have, and a human
taking control here can just as easily disrupt whatever the agent itself
is mid-way through doing with it -- that's an accepted tradeoff of a
genuine takeover feature, not an oversight.
"""

from __future__ import annotations

import json

import web

from channel.web.core._common import _require_auth, _require_capability
from common.log import logger


def _get_shared_service():
    """The browser tool's shared BrowserService, or None if no browser
    session has ever been started this process. Read-only access -- never
    constructs one, since that would start a browser just to look at it."""
    try:
        from agent.tools.browser.browser_tool import BrowserTool

        return BrowserTool._shared_service
    except Exception as e:
        logger.debug(f"[BrowserView] could not resolve shared browser service: {e}")
        return None


class BrowserStatusHandler:
    """GET /api/browser/status -- {"running": bool, "url": ..., "title": ...}."""

    def GET(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        service = _get_shared_service()
        if service is None or not service.is_running():
            return json.dumps({"status": "success", "running": False}, ensure_ascii=False)
        info = service.current_page_info() or {}
        return json.dumps({"status": "success", "running": True, **info}, ensure_ascii=False)


class BrowserFrameHandler:
    """GET /api/browser/frame -- the current page as a JPEG image, or a
    tiny transparent placeholder pixel when no browser is running (so an
    <img> tag never shows a broken-image icon while polling)."""

    _PLACEHOLDER_PNG = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    def GET(self):
        _require_auth()
        _require_capability("settings.security")
        service = _get_shared_service()
        frame = service.capture_frame() if service else None
        if frame is None:
            web.header('Content-Type', 'image/png')
            web.header('Cache-Control', 'no-store')
            return self._PLACEHOLDER_PNG
        web.header('Content-Type', 'image/jpeg')
        web.header('Cache-Control', 'no-store')
        return frame


class BrowserControlHandler:
    """POST /api/browser/control {"action": "click"|"type"|"key"|"scroll", ...}
    -- drives the live page via Playwright's own page.mouse/page.keyboard
    (no raw CDP session needed, those already wrap Input.dispatchMouseEvent
    etc.). Coordinates are in the SAME pixel space as the frame image
    capture_frame() returns; the client maps its own displayed/scaled
    image back to that space before sending (img.naturalWidth/Height vs.
    the rendered element size)."""

    _ACTIONS = {"click", "type", "key", "scroll", "resize"}

    def POST(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid JSON"}, ensure_ascii=False)

        action = body.get("action")
        if action not in self._ACTIONS:
            return json.dumps({"status": "error", "message": f"Unknown action {action!r}"}, ensure_ascii=False)

        service = _get_shared_service()
        if service is None or not service.is_running():
            return json.dumps({"status": "error", "message": "No browser session is running"}, ensure_ascii=False)

        if action == "click":
            result = service.click_at(float(body.get("x", 0)), float(body.get("y", 0)))
        elif action == "type":
            result = service.type_text_input(str(body.get("text") or ""))
        elif action == "key":
            result = service.press_key_input(str(body.get("key") or ""))
        elif action == "resize":
            result = service.resize_viewport(float(body.get("width", 0)), float(body.get("height", 0)))
        else:
            result = service.scroll_by_input(float(body.get("dx", 0)), float(body.get("dy", 0)))

        if isinstance(result, dict) and result.get("error"):
            return json.dumps({"status": "error", "message": result["error"]}, ensure_ascii=False)
        return json.dumps({"status": "success"}, ensure_ascii=False)
