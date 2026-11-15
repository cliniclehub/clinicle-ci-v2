"""Workflow endpoints: /api/workflows* -- n8n/Make.com-style node/edge graphs.
Same thin shape as api/task_board.py and api/meetings.py: auth-guard,
resolve org access, call the store/engine, shape the JSON response.

Org scoping mirrors meetings.py: a workflow belongs to the org that created
it (``org_id`` on the workflow, resolved from the request's own identity,
never trusted from the client), and a workflow outside the caller's org
returns the SAME 404 a nonexistent one would -- never 403 -- so a probe
can't distinguish "not yours" from "does not exist".

WorkflowWebhookHandler is the one deliberately unauthenticated route here:
its caller is an external system with no session, so the webhook token
itself (opaque, unguessable, compared with hmac.compare_digest in
workflow_store.find_workflow_by_webhook_token) is the only credential --
see that function's docstring.
"""

from __future__ import annotations

import json

import web

from agent.tools.workflows import engine
from agent.workspace import workflow_store
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


def _load_owned(workflow_id: str):
    """Returns (workflow, None) on success, or (None, json_404) on failure.
    A workflow belonging to another org is indistinguishable from a
    nonexistent one to the caller."""
    workflow = workflow_store.get_workflow(workflow_id)
    if workflow is None or workflow.get("org_id") != _org_id():
        return None, _not_found()
    return workflow, None


class WorkflowsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps({"status": "success", "workflows": workflow_store.list_workflows(_org_id())},
                           ensure_ascii=False)

    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            name = str(body.get("name") or "").strip()
            description = str(body.get("description") or "").strip()
            if not name:
                return _bad_request("name is required")
            workflow = workflow_store.create_workflow(name, description, org_id=_org_id())
            return json.dumps({"status": "success", "workflow": workflow}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Workflows] create failed: {e}")
            return json.dumps({"status": "error", "message": "Could not create workflow"})


class WorkflowHandler:
    def GET(self, workflow_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        workflow, err = _load_owned(workflow_id)
        if err:
            return err
        return json.dumps({"status": "success", "workflow": workflow}, ensure_ascii=False)

    def PUT(self, workflow_id):
        """Rename/describe -- not the graph itself (see WorkflowGraphHandler)."""
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        _workflow, err = _load_owned(workflow_id)
        if err:
            return err
        try:
            body = json.loads(web.data() or "{}")
            updated = workflow_store.rename_workflow(
                workflow_id, str(body.get("name") or "").strip(),
                description=body.get("description"),
            )
            return json.dumps({"status": "success", "workflow": updated}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))

    def DELETE(self, workflow_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        _workflow, err = _load_owned(workflow_id)
        if err:
            return err
        workflow_store.delete_workflow(workflow_id)
        return json.dumps({"status": "success"}, ensure_ascii=False)


class WorkflowGraphHandler:
    """Saves the canvas's full current node/edge state. See
    workflow_store.update_graph's docstring: this always replaces the whole
    graph, it is never a diff/patch."""

    def PUT(self, workflow_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        _workflow, err = _load_owned(workflow_id)
        if err:
            return err
        try:
            body = json.loads(web.data() or "{}")
            updated = workflow_store.update_graph(
                workflow_id, body.get("nodes") or [], body.get("edges") or [],
            )
            return json.dumps({"status": "success", "workflow": updated}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Workflows] graph save failed for {workflow_id}: {e}")
            return json.dumps({"status": "error", "message": "Could not save the workflow graph"})


class WorkflowActiveHandler:
    """Toggling this registers/deregisters every trigger.schedule node's
    scheduler task (workflow_store.set_active) -- an inactive workflow's
    webhook trigger also stops accepting calls, see
    WorkflowWebhookHandler."""

    def POST(self, workflow_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        _workflow, err = _load_owned(workflow_id)
        if err:
            return err
        try:
            body = json.loads(web.data() or "{}")
            updated = workflow_store.set_active(workflow_id, bool(body.get("active")))
            return json.dumps({"status": "success", "workflow": updated}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Workflows] activate/deactivate failed for {workflow_id}: {e}")
            return json.dumps({"status": "error", "message": "Could not change activation state"})


class WorkflowRunHandler:
    """Manual "run now" from the canvas -- runs from the FIRST trigger node
    in the graph (a workflow with more than one trigger is unusual but
    valid; manual run always exercises the first one, matching most
    n8n-style tools' "test workflow" button semantics). Runs even when the
    workflow is inactive, same as a scheduler "run now" already does for a
    plain scheduled task."""

    def POST(self, workflow_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        workflow, err = _load_owned(workflow_id)
        if err:
            return err
        trigger_node = next(
            (n for n in workflow["nodes"] if n["type"] in workflow_store.TRIGGER_TYPES), None
        )
        if trigger_node is None:
            return _bad_request("this workflow has no trigger node to run from")
        try:
            body = json.loads(web.data() or "{}")
            results = engine.run_workflow_from_trigger(
                workflow_id, trigger_node["id"], trigger_payload=body.get("payload") or {},
            )
            return json.dumps({"status": "success", "results": results}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Workflows] run failed for {workflow_id}: {e}")
            return json.dumps({"status": "error", "message": "Could not run workflow"})


class WorkflowWebhookHandler:
    """Public, unauthenticated -- see this module's docstring. Always
    returns 200 with a small JSON body (never leaks whether a token was
    almost-right vs completely wrong) so an external caller gets a clean
    contract, but the response is intentionally generic on failure."""

    def POST(self, token):
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            payload = json.loads(web.data() or "{}")
        except Exception:
            payload = {}
        try:
            results = engine.run_workflow_from_webhook(token, payload=payload)
            return json.dumps({"status": "success", "results": results}, ensure_ascii=False)
        except ValueError as e:
            web.ctx.status = "404 Not Found"
            return json.dumps({"status": "error", "message": str(e)})
        except Exception as e:
            logger.error(f"[Workflows] webhook run failed: {e}")
            web.ctx.status = "500 Internal Server Error"
            return json.dumps({"status": "error", "message": "Could not run workflow"})
