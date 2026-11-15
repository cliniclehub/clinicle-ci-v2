# encoding:utf-8
"""Guard the Workflow store's graph CRUD (nodes/edges, DAG validation,
org scoping, webhook token stability) and activation (scheduler task
registration/removal). See tests/test_workflow_engine.py for the actual
branching-execution walk this store's graphs feed into.
"""

import pytest

from agent.tools.scheduler.task_store import TaskStore
from agent.workspace import team_store, workflow_store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(workflow_store, "_store_file", lambda: str(tmp_path / "workflows.json"))
    monkeypatch.setattr(team_store, "_store_file", lambda: str(tmp_path / "teams.json"))

    scheduler_store = TaskStore(str(tmp_path / "scheduler" / "tasks.json"))
    import agent.tools.scheduler.integration as scheduler_integration
    monkeypatch.setattr(scheduler_integration, "get_task_store", lambda *a, **k: scheduler_store)
    yield scheduler_store


def _schedule_trigger(node_id="trig"):
    return {"id": node_id, "type": "trigger.schedule", "position": {"x": 0, "y": 0},
            "config": {"schedule": {"type": "interval", "seconds": 3600}}}


def _webhook_trigger(node_id="hook"):
    return {"id": node_id, "type": "trigger.webhook", "position": {"x": 0, "y": 100}, "config": {}}


def _team_task_node(node_id, team_id, subject="Do the thing"):
    return {"id": node_id, "type": "action.team_task", "position": {"x": 100, "y": 0},
            "config": {"team_id": team_id, "subject": subject}}


def _team():
    return team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])


def test_create_workflow_starts_with_an_empty_graph():
    created = workflow_store.create_workflow("Monday planning", "weekly kickoff", org_id="1")
    assert created["name"] == "Monday planning"
    assert created["nodes"] == []
    assert created["active"] is False


def test_list_workflows_scoped_to_org():
    workflow_store.create_workflow("Org 1's", "", org_id="1")
    workflow_store.create_workflow("Org 2's", "", org_id="2")
    assert len(workflow_store.list_workflows("1")) == 1
    assert len(workflow_store.list_workflows("2")) == 1
    assert workflow_store.list_workflows("1")[0]["name"] == "Org 1's"


def test_update_graph_rejects_invalid_node_type():
    wf = workflow_store.create_workflow("bad", "", org_id="1")
    with pytest.raises(ValueError):
        workflow_store.update_graph(wf["id"], [{"id": "n1", "type": "not_a_real_type", "config": {}}], [])


def test_update_graph_rejects_duplicate_node_ids():
    wf = workflow_store.create_workflow("dup", "", org_id="1")
    nodes = [_schedule_trigger("n1"), {**_team_task_node("n1", "t1"), "type": "action.team_task"}]
    with pytest.raises(ValueError, match="duplicate"):
        workflow_store.update_graph(wf["id"], nodes, [])


def test_update_graph_rejects_edge_to_unknown_node():
    wf = workflow_store.create_workflow("bad edge", "", org_id="1")
    nodes = [_schedule_trigger()]
    edges = [{"source": "trig", "target": "does_not_exist"}]
    with pytest.raises(ValueError, match="unknown node"):
        workflow_store.update_graph(wf["id"], nodes, edges)


def test_update_graph_rejects_incoming_edge_to_trigger():
    wf = workflow_store.create_workflow("bad trigger edge", "", org_id="1")
    team = _team()
    nodes = [_schedule_trigger(), _team_task_node("a", team["id"])]
    edges = [{"source": "a", "target": "trig"}]
    with pytest.raises(ValueError, match="trigger"):
        workflow_store.update_graph(wf["id"], nodes, edges)


def test_update_graph_rejects_condition_edge_without_a_handle():
    wf = workflow_store.create_workflow("bad handle", "", org_id="1")
    team = _team()
    nodes = [
        _schedule_trigger(),
        {"id": "cond", "type": "logic.condition", "position": {"x": 0, "y": 0},
         "config": {"source_node_id": "trigger", "path": "x", "operator": "eq", "value": 1}},
        _team_task_node("a", team["id"]),
    ]
    edges = [{"source": "trig", "target": "cond"}, {"source": "cond", "target": "a"}]  # missing source_handle
    with pytest.raises(ValueError, match="source_handle"):
        workflow_store.update_graph(wf["id"], nodes, edges)


def test_update_graph_rejects_cycles():
    wf = workflow_store.create_workflow("cyclic", "", org_id="1")
    team = _team()
    nodes = [_schedule_trigger(), _team_task_node("a", team["id"]), _team_task_node("b", team["id"])]
    edges = [
        {"source": "trig", "target": "a"},
        {"source": "a", "target": "b"},
        {"source": "b", "target": "a"},
    ]
    with pytest.raises(ValueError, match="cycle"):
        workflow_store.update_graph(wf["id"], nodes, edges)


def test_webhook_token_generated_once_and_stable_across_resaves():
    wf = workflow_store.create_workflow("hooked", "", org_id="1")
    updated = workflow_store.update_graph(wf["id"], [_webhook_trigger()], [])
    token = updated["nodes"][0]["config"]["token"]
    assert token

    resaved = workflow_store.update_graph(wf["id"], updated["nodes"], [])
    assert resaved["nodes"][0]["config"]["token"] == token


def test_find_workflow_by_webhook_token():
    wf = workflow_store.create_workflow("findme", "", org_id="1")
    updated = workflow_store.update_graph(wf["id"], [_webhook_trigger()], [])
    token = updated["nodes"][0]["config"]["token"]

    found = workflow_store.find_workflow_by_webhook_token(token)
    assert found is not None
    found_wf, found_node = found
    assert found_wf["id"] == wf["id"]
    assert found_node["id"] == "hook"

    assert workflow_store.find_workflow_by_webhook_token("wrong-token") is None
    assert workflow_store.find_workflow_by_webhook_token("") is None


def test_set_active_registers_and_removes_scheduler_task(isolated_store):
    wf = workflow_store.create_workflow("scheduled", "", org_id="1")
    workflow_store.update_graph(wf["id"], [_schedule_trigger()], [])

    activated = workflow_store.set_active(wf["id"], True)
    assert activated["active"] is True
    task_id = activated["nodes"][0]["runtime"]["scheduler_task_id"]
    assert task_id
    assert any(t["id"] == task_id for t in isolated_store.list_tasks())

    deactivated = workflow_store.set_active(wf["id"], False)
    assert deactivated["active"] is False
    assert deactivated["nodes"][0]["runtime"] == {}
    assert not any(t["id"] == task_id for t in isolated_store.list_tasks())


def test_delete_workflow_deactivates_first():
    wf = workflow_store.create_workflow("to delete", "", org_id="1")
    workflow_store.update_graph(wf["id"], [_schedule_trigger()], [])
    workflow_store.set_active(wf["id"], True)

    assert workflow_store.delete_workflow(wf["id"]) is True
    assert workflow_store.get_workflow(wf["id"]) is None


def test_delete_nonexistent_workflow_returns_false():
    assert workflow_store.delete_workflow("does_not_exist") is False
