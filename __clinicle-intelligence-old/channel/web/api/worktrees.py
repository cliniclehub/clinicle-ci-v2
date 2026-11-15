"""Worktree merge-back endpoints: /api/worktrees/* -- the human review
surface for isolated git-worktree sub agent runs staged by
agent/subagent/worktree.py (see runner.py's _run_one). A finished isolated
run with real changes is neither auto-merged nor auto-discarded; it waits
here until a human picks one.
"""

from __future__ import annotations

import json

import web

from agent.subagent import worktree
from channel.web.core._common import _require_auth


def _bad_request(message: str):
    web.ctx.status = "400 Bad Request"
    return json.dumps({"status": "error", "message": message})


class WorktreesHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps(
            {"status": "success", "worktrees": worktree.list_pending_worktrees()},
            ensure_ascii=False,
        )


class WorktreeActionHandler:
    """POST /api/worktrees/<id> {"action": "merge"|"discard"|"abort"}

    "merge" on conflict no longer auto-aborts -- it returns an error with
    conflict=true and leaves the worktree's merge_conflict flag set; the
    client then uses WorktreeConflictsHandler/WorktreeResolveHandler/
    WorktreeCompleteHandler below, or "abort" to back out."""

    _ACTIONS = {
        "merge": worktree.merge_worktree,
        "discard": worktree.discard_worktree,
        "abort": worktree.abort_merge_conflict,
    }

    def POST(self, entry_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return _bad_request("Invalid request")
        action = str(body.get("action") or "").strip()
        if action not in self._ACTIONS:
            return _bad_request("action must be 'merge', 'discard', or 'abort'")

        result = self._ACTIONS[action](entry_id)
        if not result["ok"]:
            return json.dumps(
                {"status": "error", "message": result["message"], "conflict": bool(result.get("conflict"))},
                ensure_ascii=False,
            )
        return json.dumps(
            {"status": "success", "message": result["message"], "worktrees": worktree.list_pending_worktrees()},
            ensure_ascii=False,
        )


class WorktreeConflictsHandler:
    """GET /api/worktrees/<id>/conflicts -- the conflicting files of an
    in-progress merge, each parsed into context/conflict blocks."""

    def GET(self, entry_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        result = worktree.get_merge_conflicts(entry_id)
        if not result["ok"]:
            return json.dumps({"status": "error", "message": result["message"]}, ensure_ascii=False)
        return json.dumps({"status": "success", "files": result["files"]}, ensure_ascii=False)


class WorktreeResolveHandler:
    """POST /api/worktrees/<id>/resolve {"path": "...", "resolutions": ["ours"|"theirs"|<manual text>, ...]}
    One resolution per conflict block in that file, in order."""

    def POST(self, entry_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return _bad_request("Invalid request")
        path = str(body.get("path") or "").strip()
        resolutions = body.get("resolutions")
        if not path or not isinstance(resolutions, list):
            return _bad_request("path and resolutions (a list) are required")

        result = worktree.resolve_conflict_hunks(entry_id, path, resolutions)
        if not result["ok"]:
            return json.dumps({"status": "error", "message": result["message"]}, ensure_ascii=False)
        return json.dumps({"status": "success", "message": result["message"]}, ensure_ascii=False)


class WorktreeResolveBinaryHandler:
    """POST /api/worktrees/<id>/resolve-binary {"path": "...", "choice": "ours"|"theirs"}
    Whole-file resolution for a binary conflict (see get_merge_conflicts'
    {"binary": true} shape) -- there is no hunk to diff."""

    def POST(self, entry_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return _bad_request("Invalid request")
        path = str(body.get("path") or "").strip()
        choice = str(body.get("choice") or "").strip()
        if not path or choice not in ("ours", "theirs"):
            return _bad_request("path and choice ('ours' or 'theirs') are required")

        result = worktree.resolve_binary_conflict(entry_id, path, choice)
        if not result["ok"]:
            return json.dumps({"status": "error", "message": result["message"]}, ensure_ascii=False)
        return json.dumps({"status": "success", "message": result["message"]}, ensure_ascii=False)


class WorktreeCompleteHandler:
    """POST /api/worktrees/<id>/complete -- finishes an in-progress merge
    once every conflicting file has been resolved."""

    def POST(self, entry_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        result = worktree.complete_merge(entry_id)
        if not result["ok"]:
            return json.dumps({"status": "error", "message": result["message"]}, ensure_ascii=False)
        return json.dumps(
            {"status": "success", "message": result["message"], "worktrees": worktree.list_pending_worktrees()},
            ensure_ascii=False,
        )
