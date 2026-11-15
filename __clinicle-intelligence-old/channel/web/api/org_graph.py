"""Org Graph endpoints: /api/org/graph and /api/org/teams/<id>.

Read side over ``agent/workspace/org_graph.py``; the team-tagging write
lives here rather than in ``teams.py`` because it is an org-admin action
(who does this org's map include), not a team-roster action.
"""

import json

import web

from agent.workspace import org_graph, team_store
from channel.web.api.tenancy import _error, _require_membership


class OrgGraphHandler:
    """GET /api/org/graph -- this org's team/agent map.

    Same legacy-install fallback as ``OrgMembersHandler``/``OrgInvitesHandler``
    in ``tenancy.py`` (see their docstrings): a no-account install has no org
    concept at all, so this returns an empty, ``applicable: false`` graph
    rather than a hard 401 -- fetched unconditionally on page load, same as
    those two."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        from agent.tenancy.store import get_tenancy_store

        if not get_tenancy_store().has_any_user():
            return json.dumps({"status": "success", "nodes": [], "edges": [], "applicable": False})
        _acting_user_id, org_id = _require_membership("member")
        org = get_tenancy_store().get_organization(org_id)
        graph = org_graph.build_org_graph(org_id, org_name=org.name if org else None)
        return json.dumps({"status": "success", "applicable": True, **graph}, ensure_ascii=False)


class OrgTeamAssignHandler:
    """POST /api/org/teams/<team_id> {"linked": true|false} -- admin+ only.

    Always links/unlinks to the ACTING user's own org_id, resolved server
    side exactly like every other tenancy-scoped write in this codebase
    (see ``_require_membership``'s docstring) -- the request body never
    names an org_id, so an admin can only ever pull a team into their own
    org, never move one out of someone else's.

    Teams are a global, org-less concept everywhere else in the app (see
    ``team_store.py`` and ``teams.py``'s ``TeamsHandler`` -- no ownership
    check exists on a team_id today); this endpoint does not add one. A team
    already linked to a DIFFERENT org than the caller's is a real contention
    case, not a silent reassignment: linking fails with 409 unless the
    request explicitly passes ``force: true`` -- there is still no
    per-team ownership lock underneath, just a confirmation step in front of
    the one action that could otherwise pull a team out of another org
    without anyone there noticing."""

    def POST(self, team_id):
        web.header('Content-Type', 'application/json; charset=utf-8')
        _acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        linked = bool(body.get("linked", True))
        force = bool(body.get("force", False))

        if linked:
            existing = team_store.get_team(team_id)
            if existing is None:
                raise _error("404 Not Found", "Team not found")
            existing_org = existing.get("org_id")
            if existing_org is not None and str(existing_org) != str(org_id) and not force:
                web.ctx.status = "409 Conflict"
                return json.dumps({
                    "status": "error",
                    "code": "org_contention",
                    "message": (
                        "This team is already linked to another organization. "
                        "Resend with force=true to move it here instead."
                    ),
                }, ensure_ascii=False)

        team = team_store.set_team_org(team_id, org_id if linked else None)
        if team is None:
            raise _error("404 Not Found", "Team not found")
        return json.dumps({"status": "success", "team": team}, ensure_ascii=False)
