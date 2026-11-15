"""Team endpoints: /api/teams and friends.

A team is a named roster of Agent "slots" — see `agent/workspace/team_store.py`
for the model. This layer is thin: auth-guard, parse, call the store, shape the
JSON response. Missing teams return the same "not found" shape whether the id
never existed or belonged to someone else, so a bad id can't be used to probe
which ids are real.
"""

import json

import web

from agent.workspace import team_store
from channel.web.core._common import _require_auth
from common.log import logger


def _not_found():
    web.ctx.status = "404 Not Found"
    return json.dumps({"status": "error", "message": "Team not found"})


class TeamsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps({"status": "success", "teams": team_store.list_teams()}, ensure_ascii=False)

    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            team = team_store.create_team(
                body.get("name", ""), body.get("members") or [], body.get("workspace") or None,
            )
            return json.dumps({"status": "success", "team": team}, ensure_ascii=False)
        except (ValueError, FileNotFoundError) as e:
            return json.dumps({"status": "error", "message": str(e)})
        except Exception as e:
            logger.error(f"[Teams] create failed: {e}")
            return json.dumps({"status": "error", "message": "Could not create team"})


class TeamHandler:
    def GET(self, team_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        team = team_store.get_team(team_id)
        if team is None:
            return _not_found()
        return json.dumps({"status": "success", "team": team}, ensure_ascii=False)

    def PUT(self, team_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            team = team_store.rename_team(team_id, body.get("name", ""))
            if team is None:
                return _not_found()
            return json.dumps({"status": "success", "team": team}, ensure_ascii=False)
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})

    def DELETE(self, team_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        if not team_store.delete_team(team_id):
            return _not_found()
        return json.dumps({"status": "success"})


class TeamWorkHandler:
    """Polled by the Teams grid to show a live 'working' spinner on a column
    while team_manage(delegate) is mid-flight against that slot -- see
    team_store.get_slot_work(). Same not-found shape as TeamHandler: a team_id
    that was never yours must look identical to one that never existed."""

    def GET(self, team_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        team = team_store.get_team(team_id)
        if team is None:
            return _not_found()
        return json.dumps({"status": "success", "work": team_store.get_slot_work(team_id)}, ensure_ascii=False)


class TeamMembersHandler:
    def POST(self, team_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            agent_id = str(body.get("agent_id") or "").strip()
            if not agent_id:
                return json.dumps({"status": "error", "message": "agent_id is required"})
            team = team_store.add_member(team_id, agent_id)
            if team is None:
                return _not_found()
            return json.dumps({"status": "success", "team": team}, ensure_ascii=False)
        except FileNotFoundError as e:
            return json.dumps({"status": "error", "message": str(e)})
        except Exception as e:
            logger.error(f"[Teams] add member failed: {e}")
            return json.dumps({"status": "error", "message": "Could not add member"})

    def DELETE(self, team_id, slot_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            team = team_store.remove_member(team_id, slot_id)
            if team is None:
                return _not_found()
            return json.dumps({"status": "success", "team": team}, ensure_ascii=False)
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})
