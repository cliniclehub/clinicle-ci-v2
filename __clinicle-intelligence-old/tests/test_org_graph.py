# encoding:utf-8
"""agent/workspace/org_graph.py: pure aggregation over team_store's org-tagged
teams into the org-graph view's {nodes, edges} shape. No tenancy DB touched
here -- org_id is just an int the caller already resolved (see
channel/web/api/org_graph.py's tests for the HTTP-layer resolution)."""

import pytest

from agent.workspace import org_graph, project_store, team_store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    path = tmp_path / "teams.json"
    monkeypatch.setattr(team_store, "_store_file", lambda: str(path))
    monkeypatch.setattr(project_store, "_store_file", lambda: str(tmp_path / "projects.json"))
    yield path


def test_empty_org_returns_only_the_org_node():
    graph = org_graph.build_org_graph(1, org_name="Acme")
    assert graph["nodes"] == [{"id": "org:1", "type": "org", "label": "Acme"}]
    assert graph["edges"] == []


def test_team_and_agent_nodes_and_edges():
    team_store.create_team("Clinical", [
        {"agent_id": "doctor-copilot", "role": "leader"},
        {"agent_id": "quality-supervisor", "role": "teammate"},
    ], org_id=1)

    graph = org_graph.build_org_graph(1, org_name="Acme")
    node_ids = {n["id"] for n in graph["nodes"]}
    assert "org:1" in node_ids
    assert "agent:doctor-copilot" in node_ids
    assert "agent:quality-supervisor" in node_ids
    team_node = next(n for n in graph["nodes"] if n["type"] == "team")
    assert team_node["label"] == "Clinical"

    edge_pairs = {(e["source"], e["target"]) for e in graph["edges"]}
    assert ("org:1", team_node["id"]) in edge_pairs
    assert (team_node["id"], "agent:doctor-copilot") in edge_pairs
    assert (team_node["id"], "agent:quality-supervisor") in edge_pairs


def test_teams_from_other_orgs_are_excluded():
    team_store.create_team("mine", [{"agent_id": "boss", "role": "leader"}], org_id=1)
    team_store.create_team("theirs", [{"agent_id": "boss", "role": "leader"}], org_id=2)

    graph = org_graph.build_org_graph(1)
    team_labels = {n["label"] for n in graph["nodes"] if n["type"] == "team"}
    assert team_labels == {"mine"}


def test_agent_in_two_teams_is_one_node_with_two_edges():
    team_store.create_team("a", [{"agent_id": "shared", "role": "leader"}], org_id=1)
    team_store.create_team("b", [{"agent_id": "shared", "role": "leader"}], org_id=1)

    graph = org_graph.build_org_graph(1)
    agent_nodes = [n for n in graph["nodes"] if n["id"] == "agent:shared"]
    assert len(agent_nodes) == 1
    agent_edges = [e for e in graph["edges"] if e["target"] == "agent:shared"]
    assert len(agent_edges) == 2


def test_two_slots_of_the_same_agent_in_one_team_collapse_to_one_edge():
    team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "boss", "role": "teammate"},
    ], org_id=1)

    graph = org_graph.build_org_graph(1)
    agent_edges = [e for e in graph["edges"] if e["target"] == "agent:boss"]
    assert len(agent_edges) == 1


def test_task_counts_reflect_team_task_statuses():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}], org_id=1)
    team_store.create_task(team["id"], "one")
    t2 = team_store.create_task(team["id"], "two")
    team_store.update_task_status(team["id"], t2["id"], "done")

    graph = org_graph.build_org_graph(1)
    team_node = next(n for n in graph["nodes"] if n["type"] == "team")
    assert team_node["task_counts"]["todo"] == 1
    assert team_node["task_counts"]["done"] == 1
    assert team_node["task_counts"]["backlog"] == 0
