"""DAG execution engine for workflow graphs (agent/workspace/workflow_store.py).

A run starts from one trigger node's outgoing edges and walks forward. Every
non-condition node has one implicit output; a ``logic.condition`` node has
two (``true``/``false``), and only the edges matching the node's evaluated
branch are followed -- this is the actual branching n8n/Make.com-style
workflows need, not just a visual layer over a linear runner.

Node type -> handler is a plain dict registry (``NODE_HANDLERS``), not an
if/elif chain, since node types are expected to grow (this is the same
reasoning a plugin/toolkit registry uses anywhere else in this codebase).
Each handler is ``(node, context) -> {"result": ..., "branch": "true"|"false"|None}``
and may raise; a raised exception stops that branch only, not the whole run
(one bad node shouldn't silently swallow the rest of an unrelated branch).

Trigger registration (schedule) hooks into the EXISTING scheduler
(agent/tools/scheduler) rather than building a second one: a scheduled task
with ``action.type == "workflow_run"`` is created/removed here, and
agent/tools/scheduler/integration.py's dispatch calls back into
run_workflow_from_trigger when that task fires.
"""

from __future__ import annotations

import time
import uuid
from collections import deque
from typing import Any, Callable, Dict, List, Optional

from common.log import logger
from common.runtime_identity import RuntimeIdentity, use_identity

NODE_HANDLERS: Dict[str, Callable[[dict, dict], dict]] = {}


def register(node_type: str):
    def decorator(fn: Callable[[dict, dict], dict]):
        NODE_HANDLERS[node_type] = fn
        return fn
    return decorator


# ---------------------------------------------------------------------------
# Node handlers
# ---------------------------------------------------------------------------

@register("action.team_task")
def _run_team_task(node: dict, context: dict) -> dict:
    """Reuses agent.workspace.team_store.create_task -- the exact call
    channel/web/api/task_board.py's BoardTasksHandler.POST already makes."""
    from agent.workspace import team_store

    cfg = node["config"]
    created = team_store.create_task(
        cfg["team_id"], cfg["subject"],
        owner=cfg.get("owner_slot_id"), blocked_by=cfg.get("blocked_task_ids"),
    )
    return {"result": created}


@register("action.connector_call")
def _run_connector_call(node: dict, context: dict) -> dict:
    """Reuses ConnectorCallTool directly -- any of the org's connected
    Composio apps as a workflow node, no per-app integration code."""
    from agent.tools.connectors.connector_call import ConnectorCallTool

    cfg = node["config"]
    result = ConnectorCallTool().execute({
        "tool_slug": cfg["tool_slug"], "arguments": cfg.get("arguments") or {},
    })
    if result.status != "success":
        raise RuntimeError(str(result.result))
    return {"result": result.result}


@register("action.list_connected_apps")
def _run_list_connected_apps(node: dict, context: dict) -> dict:
    """Every Composio app currently connected for this org, so a later node
    can branch/iterate on the exact set the Connectors page shows -- no
    hardcoded app list to drift out of sync as connections come and go."""
    from agent.tools.connectors.connector_call import list_connected_apps

    return {"result": {"apps": list_connected_apps()}}


def _resolve_path(value: Any, path: str) -> Any:
    if not path:
        return value
    current = value
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.lstrip("-").isdigit():
            idx = int(part)
            current = current[idx] if -len(current) <= idx < len(current) else None
        else:
            return None
    return current


def _evaluate(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "exists":
        return actual is not None
    if operator == "not_exists":
        return actual is None
    if operator == "eq":
        return actual == expected
    if operator == "neq":
        return actual != expected
    if operator == "contains":
        try:
            return expected in actual
        except TypeError:
            return False
    try:
        if operator == "gt":
            return actual is not None and actual > expected
        if operator == "lt":
            return actual is not None and actual < expected
    except TypeError:
        return False
    return False


@register("logic.condition")
def _run_condition(node: dict, context: dict) -> dict:
    cfg = node["config"]
    source = context.get(cfg.get("source_node_id"))
    if source is None and cfg.get("source_node_id") == "trigger":
        source = context.get("trigger")
    actual = _resolve_path(source, cfg.get("path", ""))
    passed = _evaluate(actual, cfg.get("operator"), cfg.get("value"))
    branch = "true" if passed else "false"
    return {"result": {"actual": actual, "branch": branch}, "branch": branch}


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def run_workflow_from_trigger(workflow_id: str, trigger_node_id: str,
                               trigger_payload: Optional[dict] = None) -> List[Dict]:
    """Walks the graph forward from ``trigger_node_id``'s outgoing edges,
    executing each reachable node once. Returns one result entry per node
    actually visited, in execution order. A failing node stops only the
    branch it's on -- edges leaving OTHER already-queued nodes still run,
    since a workflow with two independent branches off one trigger shouldn't
    have one branch's failure silently cancel the other."""
    from agent.workspace import workflow_store

    workflow = workflow_store.get_workflow(workflow_id)
    if workflow is None:
        raise ValueError(f"workflow '{workflow_id}' not found")

    nodes_by_id = {n["id"]: n for n in workflow["nodes"]}
    edges_by_source: Dict[str, List[dict]] = {}
    for edge in workflow["edges"]:
        edges_by_source.setdefault(edge["source"], []).append(edge)

    def _next_edges(node_id: str, branch: Optional[str] = None) -> List[dict]:
        edges = edges_by_source.get(node_id, [])
        if branch is None:
            return [e for e in edges if not e.get("source_handle")]
        return [e for e in edges if e.get("source_handle") == branch]

    context: Dict[str, Any] = {"trigger": trigger_payload or {}}
    results: List[Dict] = []
    visited = set()
    queue = deque(_next_edges(trigger_node_id))

    while queue:
        edge = queue.popleft()
        node = nodes_by_id.get(edge["target"])
        if node is None or node["id"] in visited:
            continue
        visited.add(node["id"])

        handler = NODE_HANDLERS.get(node["type"])
        if handler is None:
            results.append({"node_id": node["id"], "type": node["type"], "status": "error",
                             "message": f"no handler registered for node type {node['type']!r}"})
            continue
        try:
            outcome = handler(node, context)
            context[node["id"]] = outcome.get("result")
            results.append({"node_id": node["id"], "type": node["type"], "status": "ok",
                             "result": outcome.get("result")})
            queue.extend(_next_edges(node["id"], branch=outcome.get("branch")))
        except Exception as e:
            logger.error(f"[WorkflowEngine] node {node['id']} ({node['type']}) failed in workflow {workflow_id}: {e}")
            results.append({"node_id": node["id"], "type": node["type"], "status": "error", "message": str(e)})

    workflow_store.record_run(workflow_id)
    return results


def run_workflow_from_webhook(token: str, payload: Optional[dict] = None) -> List[Dict]:
    """Entry point for channel/web/api/workflows.py's public webhook
    handler. Only an ACTIVE workflow's webhook accepts calls -- deactivating
    a workflow is sufficient to stop it, no separate webhook-disable step."""
    from agent.workspace import workflow_store

    found = workflow_store.find_workflow_by_webhook_token(token)
    if found is None:
        raise ValueError("no workflow is listening on this webhook")
    workflow, node = found
    if not workflow.get("active"):
        raise ValueError("this workflow is not active")
    with use_identity(RuntimeIdentity(org_id=workflow.get("org_id"))):
        return run_workflow_from_trigger(workflow["id"], node["id"], trigger_payload=payload)


# ---------------------------------------------------------------------------
# Schedule-trigger <-> existing scheduler wiring
# ---------------------------------------------------------------------------

def register_schedule_trigger(workflow_id: str, node: dict) -> str:
    """Creates a scheduler task whose action is 'workflow_run' -- dispatch
    for that action type lives in agent/tools/scheduler/integration.py's
    _run_scheduled_task, calling back into run_workflow_from_trigger. Reuses
    the exact next-run calculation SchedulerCreateHandler.POST already makes
    (agent/workspace/workflow_store.py's old _dispatch_scheduled_task did
    the same)."""
    from datetime import datetime

    from agent.tools.scheduler.integration import get_task_store
    from agent.tools.scheduler.scheduler_service import SchedulerService

    store = get_task_store()
    if store is None:
        raise RuntimeError("scheduler store unavailable")

    task_id = f"wf-{uuid.uuid4().hex[:10]}"
    task_data = {
        "id": task_id,
        "name": f"workflow:{workflow_id}:{node['id']}",
        "enabled": True,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "schedule": node["config"]["schedule"],
        "action": {"type": "workflow_run", "workflow_id": workflow_id, "trigger_node_id": node["id"]},
    }
    temp_service = SchedulerService(store, lambda t: None)
    next_run = temp_service._calculate_next_run(task_data, datetime.now())
    if not next_run:
        raise ValueError(f"could not calculate next run time for trigger node {node['id']}")
    task_data["next_run_at"] = next_run.isoformat()
    store.add_task(task_data)
    return task_id


def unregister_schedule_trigger(task_id: str) -> None:
    from agent.tools.scheduler.integration import get_task_store

    store = get_task_store()
    if store is None:
        return
    try:
        store.delete_task(task_id)
    except Exception as e:
        logger.warning(f"[WorkflowEngine] could not remove scheduler task {task_id}: {e}")
