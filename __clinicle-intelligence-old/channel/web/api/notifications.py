"""Notifications endpoint: /api/notifications -- the header bell's one data
source, aggregating Review Queue / Pending Edits / worktree conflicts /
scheduler run completions (agent/workspace/notifications.py) into one flat
list. Same thin shape as review_queue.py: auth-guard, resolve org scope,
call the aggregator, shape JSON. Read/unread state lives client-side (see
channel/web/static/js/core/notifications.js) -- this endpoint has no
concept of "seen," it only reports what currently qualifies.
"""

from __future__ import annotations

import json

import web

from agent.workspace import notifications
from channel.web.core._common import _require_auth
from common.runtime_identity import current_identity


def _org_id() -> str:
    return current_identity().org_id


class NotificationsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        items = notifications.list_notifications(_org_id())
        return json.dumps({"status": "success", "items": items}, ensure_ascii=False)
