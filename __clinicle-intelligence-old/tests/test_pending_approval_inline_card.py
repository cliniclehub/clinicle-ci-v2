"""channel/web/core/channel.py's tool_execution_end -> tool_end mapping for a
write staged by the approval gate (agent/permission/execution_gate.py):
the pending_approval/pending_id/diff/path fields must reach the SSE wire
payload so chat/send.js can render the inline Accept/Reject card, and
pending-edits.js must actually define the renderer send.js calls."""

from pathlib import Path
from types import SimpleNamespace

from channel.web.web_channel import WebChannel

ROOT = Path(__file__).parents[1]


def test_pending_approval_fields_reach_the_sse_payload():
    published = []
    channel = SimpleNamespace(
        sse_streams={"req": object()},
        _publish_sse_event=lambda request_id, item: published.append((request_id, item)),
    )
    callback = WebChannel.__wrapped__._make_sse_callback(channel, "req")

    callback({
        "type": "tool_execution_end",
        "data": {
            "tool_call_id": "tc1",
            "tool_name": "edit",
            "status": "error",
            "result": "staged message",
            "execution_time": 0,
            "pending_approval": True,
            "pending_id": "pend_abc123",
            "diff": "--- a\n+++ b\n",
            "path": "a.py",
        },
    })

    payload = published[0][1]
    assert payload["type"] == "tool_end"
    assert payload["pending_approval"] is True
    assert payload["pending_id"] == "pend_abc123"
    assert payload["diff"] == "--- a\n+++ b\n"
    assert payload["path"] == "a.py"


def test_a_normal_tool_end_carries_no_pending_approval_fields():
    published = []
    channel = SimpleNamespace(
        sse_streams={"req": object()},
        _publish_sse_event=lambda request_id, item: published.append((request_id, item)),
    )
    callback = WebChannel.__wrapped__._make_sse_callback(channel, "req")

    callback({
        "type": "tool_execution_end",
        "data": {"tool_call_id": "tc1", "tool_name": "read", "status": "success", "result": "ok"},
    })

    payload = published[0][1]
    assert "pending_approval" not in payload
    assert "pending_id" not in payload


def test_frontend_wires_the_inline_card_through_the_tool_end_handler():
    send_js = (ROOT / "channel/web/static/js/chat/send.js").read_text(encoding="utf-8")
    pending_edits_js = (ROOT / "channel/web/static/js/views/pending-edits.js").read_text(encoding="utf-8")

    assert "item.pending_approval" in send_js
    assert "_appendPendingApprovalCard(toolEl, item)" in send_js
    assert "function _appendPendingApprovalCard(" in pending_edits_js
    assert "function _actionInlinePendingEdit(" in pending_edits_js
    # The inline card hits the SAME approve/reject endpoint as the dedicated
    # Pending Edits page -- no separate API surface to keep in sync.
    assert "/api/pending-edits/" in pending_edits_js
