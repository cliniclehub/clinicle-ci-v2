"""The Home/chat view's Activity panel: /api/activity.

Aggregates two data sources that already track "what agents are doing right
now" into one feed, rather than inventing new tracking: team tasks in flight
(``agent/workspace/team_store.py`` -- ``in_progress``/``review`` tasks ARE the
real background work; ``autopilot`` marks which team is driving them) and
subagent spawns still running (the same global runs ledger
``channel/web/api/scheduler.py`` reads for scheduled-task history, via
``ConversationStore.list_runs``). Read-only, same thin shape as
``api/sovereignty.py``: auth-guard, read the stores, shape the JSON.
"""

import json

import web

from agent.workspace import team_store
from channel.web.core._common import _require_auth
from common.log import logger

_ACTIVE_TASK_STATUSES = ("in_progress", "review")
_MAX_ITEMS = 30


def _icon_for_subagent_type(name: str) -> str:
    name = (name or "").lower()
    if "research" in name:
        return "research"
    if "analy" in name or "review" in name:
        return "analysis"
    return "general"


def _team_task_items() -> list:
    items = []
    for team in team_store.list_teams():
        owners = {m["slot_id"]: m for m in team.get("members", [])}
        driven_by_autopilot = bool(team.get("autopilot"))
        for task in team.get("tasks", []):
            if task.get("status") not in _ACTIVE_TASK_STATUSES:
                continue
            owner = owners.get(task.get("owner")) or {}
            items.append({
                "id": task["id"],
                "source": "team_task",
                "team_id": team["id"],
                "team_name": team["name"],
                "icon": "autopilot" if driven_by_autopilot else "general",
                "agent_id": owner.get("agent_id", ""),
                "subject": task.get("subject", ""),
                "status": task["status"],
                "preview": task.get("result") or task.get("verify_note") or "",
                "updated_at": task.get("updated_at", 0),
                "active": task["status"] == "in_progress",
            })
    return items


def _subagent_run_items() -> list:
    """Every subagent spawn still recorded as ``running`` in the global runs
    ledger. No subject text is stored for a subagent run (only its template
    name), so the card falls back to that -- see ``agent/subagent/runner.py``.
    """
    items = []
    try:
        from agent.memory import get_conversation_store

        store = get_conversation_store()
        if store is None:
            return items
        for run in store.list_runs(status="running", limit=_MAX_ITEMS):
            extras = run.get("extras") or {}
            subagent_type = extras.get("subagent_type", "")
            items.append({
                "id": run["run_id"],
                "source": "subagent_run",
                "team_id": "",
                "team_name": "",
                "icon": _icon_for_subagent_type(subagent_type),
                "agent_id": run.get("agent_id", ""),
                "subject": subagent_type or "Subagent",
                "status": "running",
                "preview": "",
                "updated_at": run.get("started_at", 0),
                "active": True,
            })
    except Exception as e:
        logger.debug(f"[Activity] subagent runs read failed: {e}")
    return items


class ActivityHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            items = _team_task_items() + _subagent_run_items()
            items.sort(key=lambda i: i.get("updated_at") or 0, reverse=True)
            return json.dumps({"status": "success", "items": items[:_MAX_ITEMS]}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[Activity] failed: {e}")
            return json.dumps({"status": "error", "message": "Could not build activity feed"})
