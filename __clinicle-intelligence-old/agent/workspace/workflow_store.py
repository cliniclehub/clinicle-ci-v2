"""Workflow store: named node/edge graphs, n8n/Make.com-style -- a trigger
node starts execution, edges carry it through action and logic nodes, a
``logic.condition`` node has two outputs (``true``/``false`` handles) so a
graph can genuinely branch. Real DAG execution
(agent/tools/workflows/engine.py), not the old "ordered list of 2+ steps,
no branching" model this file used to hold.

Storage keeps team_store.py's convention: one JSON file under
``shared_root()``, same load/save/lock pattern, now with an ``org_id`` on
each workflow (multi-tenant scoping, same shape meeting_store.py's SQLite
tables use -- kept as JSON here since a workflow graph has no relational
query need the way a meeting's ACL does).

Stored under ``<shared_root>/workflows.json``::

    {
      "workflows": {
        "wf_abc": {
          "id": "wf_abc", "org_id": "1", "name": "...", "description": "...",
          "active": false,
          "created_at": ..., "updated_at": ..., "last_run_at": ...,
          "nodes": [
            {"id": "node_1", "type": "trigger.schedule", "position": {"x":0,"y":0},
             "config": {"schedule": {"type": "cron", "expression": "0 9 * * MON"}},
             "runtime": {"scheduler_task_id": "..."}},
            {"id": "node_2", "type": "logic.condition", "position": {"x":200,"y":0},
             "config": {"source_node_id": "node_3", "path": "status", "operator": "eq", "value": "ok"}},
            {"id": "node_3", "type": "action.connector_call", "position": {"x":200,"y":150},
             "config": {"tool_slug": "SLACK_SEND_MESSAGE", "arguments": {...}}}
          ],
          "edges": [
            {"id": "edge_1", "source": "node_1", "source_handle": null, "target": "node_3"},
            {"id": "edge_2", "source": "node_2", "source_handle": "true", "target": "node_4"}
          ]
        }
      }
    }
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from common.log import logger

_lock = threading.Lock()

NODE_TYPES = (
    "trigger.schedule", "trigger.webhook",
    "action.team_task", "action.connector_call", "action.list_connected_apps",
    "logic.condition",
)
TRIGGER_TYPES = {"trigger.schedule", "trigger.webhook"}
CONDITION_HANDLES = {"true", "false"}


def _store_file() -> str:
    from common.state_dir import shared_root
    return str(shared_root() / "workflows.json")


def _load() -> Dict:
    path = _store_file()
    if not os.path.isfile(path):
        return {"workflows": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except Exception as e:
        logger.warning(f"[WorkflowStore] Could not read {path}: {e}")
        return {"workflows": {}}
    if not isinstance(data.get("workflows"), dict):
        data["workflows"] = {}
    return data


def _save(data: Dict) -> None:
    path = _store_file()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception as e:
        logger.warning(f"[WorkflowStore] Could not write {path}: {e}")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Graph validation
# ---------------------------------------------------------------------------

def _validate_node(node: Dict) -> Dict:
    node_type = node.get("type")
    if node_type not in NODE_TYPES:
        raise ValueError(f"invalid node type: {node_type!r}")
    node_id = str(node.get("id") or "").strip() or _new_id("node")
    position = node.get("position") or {}
    cleaned = {
        "id": node_id,
        "type": node_type,
        "position": {"x": float(position.get("x", 0)), "y": float(position.get("y", 0))},
        "config": dict(node.get("config") or {}),
    }
    if node_type == "trigger.webhook":
        # Generated once, server-side, and never overwritten by a later save
        # -- the token is the caller's only credential (see
        # channel/web/api/workflows.py's WorkflowWebhookHandler), so a client
        # resubmitting the same node must not accidentally mint a new one and
        # silently break an already-configured external webhook.
        existing_token = (node.get("config") or {}).get("token")
        cleaned["config"]["token"] = existing_token or secrets.token_urlsafe(24)
    if node_type == "action.team_task":
        if not cleaned["config"].get("team_id") or not cleaned["config"].get("subject"):
            raise ValueError(f"node {node_id}: action.team_task requires team_id and subject")
    if node_type == "action.connector_call":
        if not cleaned["config"].get("tool_slug"):
            raise ValueError(f"node {node_id}: action.connector_call requires tool_slug")
    if node_type == "logic.condition":
        if not cleaned["config"].get("source_node_id") or not cleaned["config"].get("operator"):
            raise ValueError(f"node {node_id}: logic.condition requires source_node_id and operator")
    if node_type == "trigger.schedule":
        if not isinstance(cleaned["config"].get("schedule"), dict):
            raise ValueError(f"node {node_id}: trigger.schedule requires a schedule")
    # runtime is engine-owned (e.g. a registered scheduler task id) -- a
    # client save must not be able to forge or clear it; only
    # set_active()/_deactivate_node() touch it.
    if "runtime" in node and isinstance(node["runtime"], dict):
        cleaned["_incoming_runtime"] = node["runtime"]
    return cleaned


def _validate_graph(nodes: List[Dict], edges: List[Dict], existing_runtime: Dict[str, Dict]) -> tuple:
    cleaned_nodes = []
    seen_ids = set()
    for raw in nodes:
        node = _validate_node(raw)
        if node["id"] in seen_ids:
            raise ValueError(f"duplicate node id: {node['id']}")
        seen_ids.add(node["id"])
        # Runtime state is carried over from what's already persisted, never
        # from the client's own save payload (see _validate_node's note).
        node["runtime"] = existing_runtime.get(node["id"], {})
        node.pop("_incoming_runtime", None)
        cleaned_nodes.append(node)

    node_ids = {n["id"] for n in cleaned_nodes}
    nodes_by_id = {n["id"]: n for n in cleaned_nodes}
    cleaned_edges = []
    adjacency: Dict[str, List[str]] = {}
    for raw in edges:
        source = str(raw.get("source") or "")
        target = str(raw.get("target") or "")
        handle = raw.get("source_handle")
        if source not in node_ids or target not in node_ids:
            raise ValueError(f"edge references an unknown node: {source} -> {target}")
        source_type = nodes_by_id[source]["type"]
        if source_type == "logic.condition":
            if handle not in CONDITION_HANDLES:
                raise ValueError(f"edge from condition node {source} needs source_handle 'true' or 'false'")
        elif handle is not None:
            raise ValueError(f"edge from non-condition node {source} must not set source_handle")
        if nodes_by_id[target]["type"] in TRIGGER_TYPES:
            raise ValueError(f"a trigger node ({target}) cannot have an incoming edge")
        cleaned_edges.append({
            "id": str(raw.get("id") or "").strip() or _new_id("edge"),
            "source": source, "source_handle": handle, "target": target,
        })
        adjacency.setdefault(source, []).append(target)

    _assert_no_cycles(node_ids, adjacency)
    return cleaned_nodes, cleaned_edges


def _assert_no_cycles(node_ids: set, adjacency: Dict[str, List[str]]) -> None:
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in node_ids}

    def visit(n: str) -> None:
        color[n] = GRAY
        for neighbor in adjacency.get(n, []):
            if color[neighbor] == GRAY:
                raise ValueError("the graph contains a cycle -- workflows must be acyclic")
            if color[neighbor] == WHITE:
                visit(neighbor)
        color[n] = BLACK

    for n in node_ids:
        if color[n] == WHITE:
            visit(n)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_workflows(org_id: Optional[str]) -> List[Dict]:
    with _lock:
        data = _load()
    workflows = [w for w in data["workflows"].values() if w.get("org_id") == org_id]
    workflows.sort(key=lambda w: w.get("updated_at", 0), reverse=True)
    return workflows


def get_workflow(workflow_id: str) -> Optional[Dict]:
    with _lock:
        data = _load()
    return data["workflows"].get(workflow_id)


def create_workflow(name: str, description: str, org_id: Optional[str]) -> Dict:
    if not name or not name.strip():
        raise ValueError("name is required")
    now = time.time()
    workflow = {
        "id": _new_id("wf"), "org_id": org_id, "name": name.strip(),
        "description": (description or "").strip(), "active": False,
        "created_at": now, "updated_at": now, "last_run_at": None,
        "nodes": [], "edges": [],
    }
    with _lock:
        data = _load()
        data["workflows"][workflow["id"]] = workflow
        _save(data)
    return workflow


def update_graph(workflow_id: str, nodes: List[Dict], edges: List[Dict]) -> Dict:
    """Replaces a workflow's node/edge graph wholesale (the canvas always
    saves its full current state, not a diff). Active workflows may still be
    edited; the change takes effect on the next trigger fire -- editing does
    not re-register triggers, use set_active(False) then set_active(True) to
    force that."""
    with _lock:
        data = _load()
        workflow = data["workflows"].get(workflow_id)
        if workflow is None:
            raise ValueError(f"workflow '{workflow_id}' not found")
        existing_runtime = {n["id"]: n.get("runtime", {}) for n in workflow.get("nodes", [])}
        cleaned_nodes, cleaned_edges = _validate_graph(nodes, edges, existing_runtime)
        workflow["nodes"] = cleaned_nodes
        workflow["edges"] = cleaned_edges
        workflow["updated_at"] = time.time()
        _save(data)
        return workflow


def rename_workflow(workflow_id: str, name: str, description: Optional[str] = None) -> Dict:
    if not name or not name.strip():
        raise ValueError("name is required")
    with _lock:
        data = _load()
        workflow = data["workflows"].get(workflow_id)
        if workflow is None:
            raise ValueError(f"workflow '{workflow_id}' not found")
        workflow["name"] = name.strip()
        if description is not None:
            workflow["description"] = description.strip()
        workflow["updated_at"] = time.time()
        _save(data)
        return workflow


def delete_workflow(workflow_id: str) -> bool:
    workflow = get_workflow(workflow_id)
    if workflow is None:
        return False
    if workflow.get("active"):
        set_active(workflow_id, False)
    with _lock:
        data = _load()
        if workflow_id not in data["workflows"]:
            return False
        del data["workflows"][workflow_id]
        _save(data)
    return True


def _set_node_runtime(workflow_id: str, node_id: str, runtime: Dict) -> None:
    with _lock:
        data = _load()
        workflow = data["workflows"].get(workflow_id)
        if workflow is None:
            return
        for node in workflow.get("nodes", []):
            if node["id"] == node_id:
                node["runtime"] = runtime
                break
        _save(data)


def set_active(workflow_id: str, active: bool) -> Dict:
    """Registers/deregisters every trigger.schedule node's scheduler task.
    trigger.webhook needs no registration -- WorkflowWebhookHandler checks
    ``workflow["active"]`` itself at call time, so toggling this off is
    already sufficient to stop it accepting calls."""
    from agent.tools.workflows import engine

    workflow = get_workflow(workflow_id)
    if workflow is None:
        raise ValueError(f"workflow '{workflow_id}' not found")

    for node in workflow.get("nodes", []):
        if node["type"] != "trigger.schedule":
            continue
        if active:
            task_id = engine.register_schedule_trigger(workflow_id, node)
            _set_node_runtime(workflow_id, node["id"], {"scheduler_task_id": task_id})
        else:
            task_id = (node.get("runtime") or {}).get("scheduler_task_id")
            if task_id:
                engine.unregister_schedule_trigger(task_id)
            _set_node_runtime(workflow_id, node["id"], {})

    with _lock:
        data = _load()
        wf = data["workflows"].get(workflow_id)
        if wf is not None:
            wf["active"] = bool(active)
            wf["updated_at"] = time.time()
            _save(data)
            workflow = wf
    return workflow


def find_workflow_by_webhook_token(token: str) -> Optional[tuple]:
    """Returns (workflow, node) for the trigger.webhook node whose token
    matches, or None. Compared with hmac.compare_digest so this can never
    leak timing information about a valid token -- the same reasoning
    channel/web/core/_common.py's own signed-token checks use."""
    import hmac

    if not token:
        return None
    with _lock:
        data = _load()
    for workflow in data["workflows"].values():
        for node in workflow.get("nodes", []):
            if node["type"] != "trigger.webhook":
                continue
            stored = str((node.get("config") or {}).get("token") or "")
            if stored and hmac.compare_digest(stored, token):
                return workflow, node
    return None


def record_run(workflow_id: str) -> None:
    with _lock:
        data = _load()
        wf = data["workflows"].get(workflow_id)
        if wf is not None:
            wf["last_run_at"] = time.time()
            _save(data)
