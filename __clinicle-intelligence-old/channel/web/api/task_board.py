"""Task Board endpoints: /api/board/* -- the fleet-wide Kanban view over every
Team's task list (backlog/todo/in_progress/review/done), plus the Autopilot
toggle. Same thin shape as api/teams.py: auth-guard, parse, call the store,
shape the JSON response. All mutations are still scoped by team_id, exactly
like every team_manage tool action -- a task_id alone is never enough.
"""

import json

import web

from agent.tools.team import autopilot
from agent.workspace import team_store
from channel.web.core._common import _require_auth
from common.log import logger


def _not_found():
    web.ctx.status = "404 Not Found"
    return json.dumps({"status": "error", "message": "Not found"})


class BoardTasksHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(team_id="")
        tasks = team_store.list_all_tasks()
        if params.team_id:
            tasks = [t for t in tasks if t["team_id"] == params.team_id]
        return json.dumps({"status": "success", "tasks": tasks}, ensure_ascii=False)

    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            team_id = str(body.get("team_id") or "").strip()
            subject = str(body.get("subject") or "").strip()
            if not team_id or not subject:
                return json.dumps({"status": "error", "message": "team_id and subject are required"})
            task = team_store.create_task(
                team_id, subject,
                owner=str(body.get("owner_slot_id") or "").strip() or None,
                blocked_by=body.get("blocked_task_ids") or [],
            )
            return json.dumps({"status": "success", "task": task}, ensure_ascii=False)
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})
        except Exception as e:
            logger.error(f"[TaskBoard] create failed: {e}")
            return json.dumps({"status": "error", "message": "Could not create task"})


class BoardTaskHandler:
    def PUT(self, task_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            team_id = str(body.get("team_id") or "").strip()
            status = str(body.get("status") or "").strip()
            if not team_id or not status:
                return json.dumps({"status": "error", "message": "team_id and status are required"})
            task = team_store.update_task_status(team_id, task_id, status)
            return json.dumps({"status": "success", "task": task}, ensure_ascii=False)
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})


class BoardAutopilotHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(team_id="")
        if not params.team_id or team_store.get_team(params.team_id) is None:
            return _not_found()
        return json.dumps(
            {
                "status": "success",
                "enabled": team_store.is_autopilot_enabled(params.team_id),
                "activity": autopilot.get_status(params.team_id),
            },
            ensure_ascii=False,
        )

    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            team_id = str(body.get("team_id") or "").strip()
            enabled = bool(body.get("enabled"))
            if not team_id:
                return json.dumps({"status": "error", "message": "team_id is required"})
            team_store.set_autopilot(team_id, enabled)
            if enabled:
                autopilot.start(team_id)
            else:
                autopilot.stop(team_id)
            return json.dumps({"status": "success", "enabled": enabled}, ensure_ascii=False)
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})
        except Exception as e:
            logger.error(f"[TaskBoard] autopilot toggle failed: {e}")
            return json.dumps({"status": "error", "message": "Could not toggle autopilot"})
