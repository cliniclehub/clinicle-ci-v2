"""Pending Edits endpoints: /api/pending-edits/* -- the human review surface
for edit/write calls staged by the approval gate
(agent/permission/execution_gate.py, agent/protocol/agent_stream.py).

Same thin shape as review_queue.py: auth-guard, resolve org scope, call the
store, shape JSON. Approving is the ONE place that actually applies a staged
change -- it constructs the same Edit/Write tool the agent would have used
(same cwd, captured at staging time) and calls execute_tool() on it directly.
"""

from __future__ import annotations

import json

import web

from agent.workspace import pending_edits_store
from channel.web.api.auth import _current_user_id
from channel.web.core._common import _require_auth
from common.log import logger
from common.runtime_identity import current_identity


def _not_found():
    web.ctx.status = "404 Not Found"
    return json.dumps({"status": "error", "message": "Not found"})


def _bad_request(message: str):
    web.ctx.status = "400 Bad Request"
    return json.dumps({"status": "error", "message": message})


def _org_id() -> str:
    return current_identity().org_id


def _build_tool(tool_name: str, cwd: str):
    if tool_name == "edit":
        from agent.tools.edit.edit import Edit
        return Edit({"cwd": cwd})
    if tool_name == "write":
        from agent.tools.write.write import Write
        return Write({"cwd": cwd})
    return None


class PendingEditsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(status='', agent_id='')
        edits = pending_edits_store.list_pending_edits(
            _org_id(), status=(params.status or None), agent_id=(params.agent_id or None),
        )
        return json.dumps({"status": "success", "pending_edits": edits}, ensure_ascii=False)


class PendingEditActionHandler:
    """POST /api/pending-edits/<id> {"action": "approve"|"reject", "note": "..."}"""

    def POST(self, pending_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _org_id()
        pending = pending_edits_store.get_pending_edit(pending_id, org_id=org_id)
        if pending is None or str(pending.get("org_id")) != str(org_id):
            return _not_found()
        if pending.get("status") != "pending":
            return _bad_request(f"already {pending['status']}")

        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return _bad_request("Invalid request")
        action = str(body.get("action") or "").strip()
        if action not in ("approve", "reject"):
            return _bad_request("action must be 'approve' or 'reject'")
        note = body.get("note")
        user_id = _current_user_id()

        if action == "reject":
            updated = pending_edits_store.resolve_pending_edit(
                pending_id, "rejected", resolved_by_user_id=user_id, note=note, org_id=org_id,
            )
            return json.dumps({"status": "success", "pending_edit": updated}, ensure_ascii=False)

        # Approve: actually run the staged call now, through the same tool
        # class and cwd the agent would have used, then record what happened
        # -- not just the intent to apply it.
        tool = _build_tool(pending["tool_name"], pending.get("cwd") or "")
        if tool is None:
            logger.error(f"[PendingEdits] Unknown tool_name on {pending_id}: {pending['tool_name']}")
            return _bad_request(f"Unsupported tool: {pending['tool_name']}")

        try:
            result = tool.execute_tool(pending["arguments"])
            result_payload = {"status": result.status, "result": result.result}
        except Exception as e:
            logger.error(f"[PendingEdits] Applying {pending_id} failed: {e}")
            result_payload = {"status": "error", "result": str(e)}

        updated = pending_edits_store.resolve_pending_edit(
            pending_id, "approved", resolved_by_user_id=user_id,
            result=result_payload, note=note, org_id=org_id,
        )
        return json.dumps({"status": "success", "pending_edit": updated}, ensure_ascii=False)
