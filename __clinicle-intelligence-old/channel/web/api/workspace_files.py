"""Built-in Code Editor + Terminal endpoints: /api/workspace/*.

The most sensitive surface in this app -- arbitrary file read/write and
shell execution scoped to an Agent's workspace -- so every handler here
gates on settings.security (admin/owner only by default; see
agent/permission/capabilities.py), not just _require_auth like the other
review/staging pages in this codebase.
"""

from __future__ import annotations

import json

import web

from agent.workspace import file_browser
from channel.web.core._common import _require_auth, _require_capability
from common.log import logger


def _bad_request(message: str):
    web.ctx.status = "400 Bad Request"
    return json.dumps({"status": "error", "message": message})


def _resolve_workspace(agent_id: str):
    """The agent's own workspace root, or None if the id doesn't resolve --
    never raises, so a bad/removed agent_id is a clean 404, not a 500."""
    if not agent_id:
        return None
    try:
        from agent.registry import get_agent_registry

        return get_agent_registry().get(agent_id, require_enabled=False).workspace
    except Exception as e:
        logger.debug(f"[WorkspaceFiles] could not resolve agent {agent_id!r}: {e}")
        return None


class WorkspaceTreeHandler:
    """GET /api/workspace/tree?agent_id=<id>&path=<subpath> -- one directory level."""

    def GET(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(agent_id='', path='')
        root = _resolve_workspace(params.agent_id)
        if root is None:
            return _bad_request("Unknown agent")
        try:
            entries = file_browser.list_tree(root, params.path)
        except file_browser.WorkspacePathError as e:
            return _bad_request(str(e))
        return json.dumps({"status": "success", "entries": entries}, ensure_ascii=False)


class WorkspaceFileHandler:
    """GET/PUT /api/workspace/file?agent_id=<id>&path=<relpath> -- read/write one file."""

    def GET(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(agent_id='', path='')
        root = _resolve_workspace(params.agent_id)
        if root is None:
            return _bad_request("Unknown agent")
        if not params.path:
            return _bad_request("path is required")
        try:
            result = file_browser.read_file(root, params.path)
        except file_browser.WorkspacePathError as e:
            return _bad_request(str(e))
        return json.dumps({"status": "success", **result}, ensure_ascii=False)

    def PUT(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(agent_id='', path='')
        root = _resolve_workspace(params.agent_id)
        if root is None:
            return _bad_request("Unknown agent")
        if not params.path:
            return _bad_request("path is required")
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return _bad_request("Invalid request")
        try:
            file_browser.write_file(root, params.path, body.get("content", ""))
        except file_browser.WorkspacePathError as e:
            return _bad_request(str(e))
        return json.dumps({"status": "success"}, ensure_ascii=False)

    def DELETE(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(agent_id='', path='')
        root = _resolve_workspace(params.agent_id)
        if root is None:
            return _bad_request("Unknown agent")
        if not params.path:
            return _bad_request("path is required")
        try:
            file_browser.delete_file(root, params.path)
        except file_browser.WorkspacePathError as e:
            return _bad_request(str(e))
        return json.dumps({"status": "success"}, ensure_ascii=False)


class WorkspaceTerminalHandler:
    """POST /api/workspace/terminal {"agent_id": "...", "command": "..."} --
    runs against a persistent per-agent shell (agent/workspace/
    terminal_session.py), so `cd` and exported env vars carry over between
    commands. Still not a full pty (no job control, no ctrl-C, no
    interactive programs) -- see that module's own docstring for the
    known limitations of this v1.

    DELETE /api/workspace/terminal?agent_id=<id> -- kills the agent's
    persistent shell; the next command starts a fresh one.
    """

    def POST(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return _bad_request("Invalid request")
        agent_id = str(body.get("agent_id") or "")
        command = str(body.get("command") or "").strip()
        if not command:
            return _bad_request("command is required")
        root = _resolve_workspace(agent_id)
        if root is None:
            return _bad_request("Unknown agent")

        from agent.workspace import terminal_session

        result = terminal_session.run_command(agent_id, root, command)
        return json.dumps({"status": "success", **result}, ensure_ascii=False)

    def DELETE(self):
        _require_auth()
        _require_capability("settings.security")
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(agent_id='')
        if not params.agent_id:
            return _bad_request("agent_id is required")

        from agent.workspace import terminal_session

        terminal_session.reset_session(params.agent_id)
        return json.dumps({"status": "success"}, ensure_ascii=False)
