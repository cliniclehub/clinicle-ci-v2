"""Review Queue endpoints: /api/review-queue/* -- the shared review surface
for every AI-raised flag (Quality Supervisor, Revenue Optimizer, VAT
Compliance, Financial Controller). Same thin shape as api/patients.py:
auth-guard, resolve org scope, call the store, shape JSON.

A flag belongs to its own org like any other business record here. GET a
flag by id checks org_id against the caller's own org and returns the SAME
404 for "not yours" and "doesn't exist" -- see patients.py's docstring for
why (A8).
"""

from __future__ import annotations

import json

import web

from agent.workspace import review_queue_store
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


class ReviewQueueHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(status='', category='')
        flags = review_queue_store.list_flags(
            _org_id(), status=(params.status or None), category=(params.category or None),
        )
        return json.dumps({"status": "success", "flags": flags}, ensure_ascii=False)


class ReviewQueueItemActionHandler:
    def POST(self, flag_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        flag = review_queue_store.get_flag(flag_id)
        if flag is None or flag.get("org_id") != _org_id():
            return _not_found()
        try:
            body = json.loads(web.data() or "{}")
            status = str(body.get("status") or "").strip()
            if status not in ("approved", "dismissed"):
                return _bad_request("status must be 'approved' or 'dismissed'")
            updated = review_queue_store.action_flag(
                flag_id, status, actioned_by_user_id=_current_user_id(), note=body.get("note"),
            )
            return json.dumps({"status": "success", "flag": updated}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[ReviewQueue] action failed: {e}")
            return json.dumps({"status": "error", "message": "Could not action flag"})
