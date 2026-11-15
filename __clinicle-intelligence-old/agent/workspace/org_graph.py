"""Org Graph: a read-only org -> teams -> agents map for the web console's
Org Graph view (``channel/web/api/org_graph.py``, ``channel/web/static/js/
views/org-graph.js``).

Deliberately NOT a task-dependency graph -- ``team_store``'s tasks already
have their own Kanban board (``channel/web/api/task_board.py``) and
``blocked_by`` chains; duplicating that as graph nodes here would be a
second, competing task UI. A team node instead carries a ``task_counts``
summary (by status) so the map answers "how is each team doing" without
trying to replace the board.

Node/edge shape matches ``agent/tools/workflows/engine.py``'s DAG
(``{"id", ...}`` nodes, ``{"source", "target"}`` edges) closely enough that
the frontend's existing D3 zoom/pan primitives (see ``workflows.js``) apply
here too, without pulling in that view's node-editor machinery this graph
has no use for -- it is read-only, there is nothing here to edit.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from agent.workspace import team_store


def _agent_label(agent_id: str) -> str:
    """Best-effort display name -- a since-deleted or misconfigured Agent
    must not break the graph, same fallback team_store._seed_leader_briefing
    already uses for the same lookup."""
    try:
        from agent.registry import get_agent_registry
        return get_agent_registry().get(agent_id).name
    except Exception:
        return agent_id


def build_org_graph(org_id: int, org_name: Optional[str] = None) -> Dict[str, List[Dict]]:
    """One org root node, one node per team tagged with this org, one node
    per distinct agent across those teams' members, and the edges between
    them. Teams/agents outside this org never enter the response -- the
    caller (``OrgGraphHandler``) always resolves ``org_id`` from the acting
    user's own membership, never from the request, so this function is only
    ever asked about the caller's own org."""
    org_node_id = f"org:{org_id}"
    nodes: List[Dict] = [{
        "id": org_node_id, "type": "org", "label": org_name or "Organization",
    }]
    edges: List[Dict] = []

    seen_agents: Dict[str, Dict] = {}
    for team in team_store.list_teams_for_org(org_id):
        team_node_id = f"team:{team['id']}"
        task_counts = {status: 0 for status in team_store.TASK_STATUSES}
        for task in team.get("tasks", []):
            status = task.get("status")
            if status in task_counts:
                task_counts[status] += 1
        nodes.append({
            "id": team_node_id, "type": "team", "label": team["name"],
            "team_id": team["id"], "task_counts": task_counts,
        })
        edges.append({"source": org_node_id, "target": team_node_id})

        # One edge per distinct agent per team -- two slots for the same
        # Agent in one team (see team_store.create_team's docstring) still
        # collapse to a single team-agent edge, there is only one real
        # relationship to show on a map.
        team_agent_ids = {m["agent_id"] for m in team.get("members", [])}
        for agent_id in team_agent_ids:
            agent_node_id = f"agent:{agent_id}"
            if agent_id not in seen_agents:
                seen_agents[agent_id] = {
                    "id": agent_node_id, "type": "agent", "label": _agent_label(agent_id),
                }
                nodes.append(seen_agents[agent_id])
            edges.append({"source": team_node_id, "target": agent_node_id})

    return {"nodes": nodes, "edges": edges}
