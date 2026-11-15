"""Guards the actual DAG execution/branching -- the part that makes this an
n8n/Make.com-style workflow engine rather than a linear step runner. See
tests/test_workflow_store.py for graph CRUD/validation."""

from unittest.mock import patch

import pytest

from agent.tools.workflows import engine
from agent.workspace import team_store, workflow_store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(workflow_store, "_store_file", lambda: str(tmp_path / "workflows.json"))
    monkeypatch.setattr(team_store, "_store_file", lambda: str(tmp_path / "teams.json"))


def _team():
    return team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])


def _branching_workflow(team_id):
    wf = workflow_store.create_workflow("branch", "", org_id="1")
    nodes = [
        {"id": "trig", "type": "trigger.schedule", "position": {"x": 0, "y": 0},
         "config": {"schedule": {"type": "interval", "seconds": 3600}}},
        {"id": "cond", "type": "logic.condition", "position": {"x": 100, "y": 0},
         "config": {"source_node_id": "trigger", "path": "level", "operator": "gt", "value": 5}},
        {"id": "high", "type": "action.team_task", "position": {"x": 200, "y": -50},
         "config": {"team_id": team_id, "subject": "high path"}},
        {"id": "low", "type": "action.team_task", "position": {"x": 200, "y": 50},
         "config": {"team_id": team_id, "subject": "low path"}},
    ]
    edges = [
        {"source": "trig", "target": "cond"},
        {"source": "cond", "source_handle": "true", "target": "high"},
        {"source": "cond", "source_handle": "false", "target": "low"},
    ]
    workflow_store.update_graph(wf["id"], nodes, edges)
    return wf


def test_condition_true_branch_runs_only_that_side():
    team = _team()
    wf = _branching_workflow(team["id"])

    results = engine.run_workflow_from_trigger(wf["id"], "trig", trigger_payload={"level": 10})

    assert [r["node_id"] for r in results] == ["cond", "high"]
    assert results[0]["result"]["branch"] == "true"
    tasks = team_store.list_tasks(team["id"])
    assert len(tasks) == 1 and tasks[0]["subject"] == "high path"


def test_condition_false_branch_runs_only_that_side():
    team = _team()
    wf = _branching_workflow(team["id"])

    results = engine.run_workflow_from_trigger(wf["id"], "trig", trigger_payload={"level": 2})

    assert [r["node_id"] for r in results] == ["cond", "low"]
    tasks = team_store.list_tasks(team["id"])
    assert len(tasks) == 1 and tasks[0]["subject"] == "low path"


def test_run_records_last_run_at():
    team = _team()
    wf = _branching_workflow(team["id"])
    assert workflow_store.get_workflow(wf["id"])["last_run_at"] is None

    engine.run_workflow_from_trigger(wf["id"], "trig", trigger_payload={"level": 1})

    assert workflow_store.get_workflow(wf["id"])["last_run_at"] is not None


def test_failing_node_is_isolated_but_run_completes():
    team = _team()
    wf = _branching_workflow(team["id"])
    workflow = workflow_store.get_workflow(wf["id"])
    nodes = workflow["nodes"] + [
        {"id": "boom", "type": "action.connector_call", "position": {"x": 300, "y": -50},
         "config": {"tool_slug": "NOPE"}},
    ]
    edges = workflow["edges"] + [{"source": "high", "target": "boom"}]
    workflow_store.update_graph(wf["id"], nodes, edges)

    results = engine.run_workflow_from_trigger(wf["id"], "trig", trigger_payload={"level": 10})

    by_id = {r["node_id"]: r for r in results}
    assert by_id["high"]["status"] == "ok"
    assert by_id["boom"]["status"] == "error"


def test_unknown_node_type_recorded_as_error_not_raised():
    wf = workflow_store.create_workflow("weird", "", org_id="1")
    # Bypass update_graph's own type validation to simulate a node type that
    # existed in an older version of the app and no handler covers anymore.
    with patch.object(workflow_store, "_validate_node", side_effect=lambda n: {
        **n, "runtime": {},
    }):
        workflow_store.update_graph(wf["id"], [
            {"id": "trig", "type": "trigger.schedule", "config": {"schedule": {}}, "position": {"x": 0, "y": 0}},
            {"id": "ghost", "type": "action.something_removed", "config": {}, "position": {"x": 0, "y": 0}},
        ], [{"source": "trig", "target": "ghost"}])

    results = engine.run_workflow_from_trigger(wf["id"], "trig")
    assert results[0]["status"] == "error"
    assert "no handler" in results[0]["message"]


def test_run_workflow_from_webhook_requires_active_workflow():
    wf = workflow_store.create_workflow("hooked", "", org_id="1")
    updated = workflow_store.update_graph(wf["id"], [
        {"id": "hook", "type": "trigger.webhook", "config": {}, "position": {"x": 0, "y": 0}},
    ], [])
    token = updated["nodes"][0]["config"]["token"]

    with pytest.raises(ValueError, match="not active"):
        engine.run_workflow_from_webhook(token)

    workflow_store.set_active(wf["id"], True)
    results = engine.run_workflow_from_webhook(token, payload={"hello": "world"})
    assert results == []  # no downstream nodes wired, but the call succeeds


def test_run_workflow_from_webhook_rejects_unknown_token():
    with pytest.raises(ValueError, match="no workflow"):
        engine.run_workflow_from_webhook("not-a-real-token")


def test_condition_path_resolution_and_operators():
    assert engine._resolve_path({"a": {"b": 3}}, "a.b") == 3
    assert engine._resolve_path({"a": [1, 2, 3]}, "a.1") == 2
    assert engine._resolve_path(None, "a.b") is None
    assert engine._evaluate(5, "gt", 3) is True
    assert engine._evaluate(5, "gt", 10) is False
    assert engine._evaluate("xyz", "contains", "y") is True
    assert engine._evaluate("xyz", "contains", "q") is False
    assert engine._evaluate(None, "exists", None) is False
    assert engine._evaluate(None, "not_exists", None) is True
