# encoding:utf-8
"""Guard the team roster store's CRUD and invariants.

The Teams UI (channel/web/api/teams.py, channel/web/static/js/views/teams.js)
leans entirely on this file being right: exactly one leader, always first,
never removable; every member gets its own independent session id, never
shared with the others.
"""

import pytest

from agent.workspace import project_store, team_store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    path = tmp_path / "teams.json"
    monkeypatch.setattr(team_store, "_store_file", lambda: str(path))
    # set_project_dir() writes here -- isolate it too, same as the team store,
    # so a workspace-binding test can't touch the real ~/cow/projects.json.
    monkeypatch.setattr(project_store, "_store_file", lambda: str(tmp_path / "projects.json"))
    yield path


def test_create_team_orders_leader_first():
    team = team_store.create_team("prodectivety", [
        {"agent_id": "writer", "role": "teammate"},
        {"agent_id": "boss", "role": "leader"},
    ])
    assert team["members"][0]["agent_id"] == "boss"
    assert team["members"][0]["role"] == "leader"
    assert team["members"][1]["agent_id"] == "writer"


def test_create_team_requires_exactly_one_leader():
    with pytest.raises(ValueError):
        team_store.create_team("no leader", [{"agent_id": "a", "role": "teammate"}])
    with pytest.raises(ValueError):
        team_store.create_team("two leaders", [
            {"agent_id": "a", "role": "leader"},
            {"agent_id": "b", "role": "leader"},
        ])


def test_members_get_independent_session_ids():
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "boss", "role": "teammate"},  # same Agent, second slot
    ])
    sessions = [m["session_id"] for m in team["members"]]
    assert len(sessions) == len(set(sessions)), "each slot must own its own session"


def test_add_member_appends_teammate():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    updated = team_store.add_member(team["id"], "writer")
    assert len(updated["members"]) == 2
    assert updated["members"][-1]["role"] == "teammate"
    assert updated["members"][-1]["agent_id"] == "writer"


def test_remove_member_refuses_to_remove_leader():
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    leader_slot = team["members"][0]["slot_id"]
    with pytest.raises(ValueError):
        team_store.remove_member(team["id"], leader_slot)


def test_remove_member_drops_teammate():
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    teammate_slot = team["members"][1]["slot_id"]
    updated = team_store.remove_member(team["id"], teammate_slot)
    assert len(updated["members"]) == 1
    assert updated["members"][0]["role"] == "leader"


def test_rename_and_delete_team():
    team = team_store.create_team("old name", [{"agent_id": "boss", "role": "leader"}])
    renamed = team_store.rename_team(team["id"], "new name")
    assert renamed["name"] == "new name"
    assert team_store.delete_team(team["id"]) is True
    assert team_store.get_team(team["id"]) is None
    assert team_store.delete_team(team["id"]) is False


def test_get_team_missing_id_returns_none():
    # The API layer turns this into a 404, same as a foreign id would get --
    # never distinguish "never existed" from "not yours".
    assert team_store.get_team("does-not-exist") is None


def test_create_team_binds_every_member_to_the_workspace(tmp_path):
    folder = tmp_path / "launch-plan"
    folder.mkdir()
    team = team_store.create_team(
        "t", [
            {"agent_id": "boss", "role": "leader"},
            {"agent_id": "writer", "role": "teammate"},
        ],
        workspace=str(folder),
    )
    assert team["workspace"] == str(folder.resolve())
    for member in team["members"]:
        assert project_store.get_project_dir(member["session_id"], member["agent_id"]) == str(folder.resolve())


def test_create_team_rejects_a_nonexistent_workspace(tmp_path):
    with pytest.raises(FileNotFoundError):
        team_store.create_team(
            "t", [{"agent_id": "boss", "role": "leader"}],
            workspace=str(tmp_path / "does-not-exist"),
        )


def test_create_team_without_workspace_leaves_it_none():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    assert team["workspace"] is None


def test_add_member_inherits_the_team_workspace(tmp_path):
    folder = tmp_path / "shared"
    folder.mkdir()
    team = team_store.create_team(
        "t", [{"agent_id": "boss", "role": "leader"}], workspace=str(folder),
    )
    updated = team_store.add_member(team["id"], "writer")
    new_member = updated["members"][-1]
    assert project_store.get_project_dir(new_member["session_id"], new_member["agent_id"]) == str(folder.resolve())


# =====================================================================
# Leader briefing: without this, a Leader has no way to know its named
# teammates are real, addressable Agents rather than the generic subagent
# tool's disposable workers -- confirmed live as the reported bug.
# =====================================================================

def test_create_team_seeds_the_leader_with_a_roster_briefing():
    from unittest.mock import MagicMock, patch

    fake_store = MagicMock()
    fake_registry = MagicMock()

    def _get(aid):
        profile = MagicMock()
        profile.name = f"{aid}-display-name"
        profile.workspace = f"/fake/{aid}"
        return profile

    fake_registry.get.side_effect = _get

    with patch("agent.registry.get_agent_registry", return_value=fake_registry), \
         patch("agent.memory.get_conversation_store", return_value=fake_store):
        team = team_store.create_team("t", [
            {"agent_id": "boss", "role": "leader"},
            {"agent_id": "writer", "role": "teammate"},
        ])

    fake_store.append_messages.assert_called_once()
    call_args = fake_store.append_messages.call_args
    session_id_arg = call_args[0][0]
    messages_arg = call_args[0][1]
    assert session_id_arg == team["members"][0]["session_id"]  # the leader's own session
    briefing_text = messages_arg[0]["content"][0]["text"]
    assert "writer-display-name" in briefing_text
    assert '"writer"' in briefing_text  # the raw agent_id, for the tool call
    assert '"boss"' in briefing_text  # the Leader's OWN agent_id -- team_manage needs it too
    assert "team_manage" in briefing_text
    assert team["id"] in briefing_text


def test_briefing_failure_does_not_block_team_creation():
    """A registry lookup can legitimately fail (a since-deleted Agent, a
    store that isn't wired up in some embedding context) -- the team itself
    must still be created either way."""
    from unittest.mock import patch

    with patch("agent.registry.get_agent_registry", side_effect=RuntimeError("boom")):
        team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    assert team["name"] == "t"
    assert team_store.get_team(team["id"]) is not None


def test_slot_work_tracks_and_clears():
    team_store.mark_slot_running("t1", "slot_1")
    work = team_store.get_slot_work("t1")
    assert set(work) == {"slot_1"}
    assert isinstance(work["slot_1"], float)
    team_store.mark_slot_idle("t1", "slot_1")
    assert team_store.get_slot_work("t1") == {}


def test_slot_work_is_scoped_per_team():
    team_store.mark_slot_running("t1", "slot_1")
    assert team_store.get_slot_work("t2") == {}
    team_store.mark_slot_idle("t1", "slot_1")


def test_shared_team_is_not_briefed():
    """The briefing is about the independent-session grid model; a shared
    conversation (the composer's own feature) has no separate teammate
    panes for the Leader to be pointed at."""
    from unittest.mock import MagicMock, patch

    fake_store = MagicMock()
    with patch("agent.memory.get_conversation_store", return_value=fake_store):
        team_store.set_shared_members("boss", "s1", ["writer"])
    fake_store.append_messages.assert_not_called()


def test_create_task_defaults_to_todo():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    task = team_store.create_task(team["id"], "write the intro", owner="slot_x")
    assert task["status"] == "todo"
    assert task["owner"] == "slot_x"
    assert task["blocked_by"] == []


def test_create_task_with_blockers_starts_in_backlog():
    # Not a separate "blocked" status/column -- see team_store.py's Task
    # board section: a task with unmet blockers starts in "backlog" and
    # ``blocked_by`` records why, for the board's lock icon and Autopilot.
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    t1 = team_store.create_task(team["id"], "backend")
    t2 = team_store.create_task(team["id"], "frontend", blocked_by=[t1["id"]])
    assert t2["status"] == "backlog"


def test_list_tasks_scoped_to_team():
    t1 = team_store.create_team("a", [{"agent_id": "boss", "role": "leader"}])
    t2 = team_store.create_team("b", [{"agent_id": "boss", "role": "leader"}])
    team_store.create_task(t1["id"], "only in a")
    assert len(team_store.list_tasks(t1["id"])) == 1
    assert len(team_store.list_tasks(t2["id"])) == 0


def test_update_task_status():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    task = team_store.create_task(team["id"], "ship it")
    updated = team_store.update_task_status(team["id"], task["id"], "done")
    assert updated["status"] == "done"
    assert team_store.list_tasks(team["id"])[0]["status"] == "done"


def test_update_task_status_rejects_unknown_status():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    task = team_store.create_task(team["id"], "ship it")
    with pytest.raises(ValueError):
        team_store.update_task_status(team["id"], task["id"], "yolo")


def test_create_task_rejects_unknown_team():
    with pytest.raises(ValueError):
        team_store.create_task("does-not-exist", "x")


# =====================================================================
# Org tagging -- the Org Graph view's write side (agent/workspace/org_graph.py)
# =====================================================================

def test_create_team_without_org_id_defaults_to_none():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    assert team["org_id"] is None


def test_create_team_accepts_an_org_id():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}], org_id=7)
    assert team["org_id"] == 7


def test_set_team_org_tags_and_untags():
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    tagged = team_store.set_team_org(team["id"], 7)
    assert tagged["org_id"] == 7
    untagged = team_store.set_team_org(team["id"], None)
    assert untagged["org_id"] is None


def test_set_team_org_on_missing_team_returns_none():
    assert team_store.set_team_org("does-not-exist", 7) is None


def test_list_teams_for_org_scopes_correctly():
    a = team_store.create_team("a", [{"agent_id": "boss", "role": "leader"}], org_id=1)
    team_store.create_team("b", [{"agent_id": "boss", "role": "leader"}], org_id=2)
    team_store.create_team("c", [{"agent_id": "boss", "role": "leader"}])  # no org

    org1_teams = team_store.list_teams_for_org(1)
    assert [t["id"] for t in org1_teams] == [a["id"]]


def test_list_teams_for_org_excludes_teams_with_no_org_id_key_at_all():
    # Simulates a team persisted before this feature existed -- teams.json
    # entries never get a migration pass, so ".get" must treat a missing key
    # the same as an explicit None (see list_teams_for_org's docstring).
    team = team_store.create_team("legacy", [{"agent_id": "boss", "role": "leader"}])
    with team_store._lock:
        data = team_store._load()
        del data["teams"][team["id"]]["org_id"]
        team_store._save(data)
    assert team_store.list_teams_for_org(1) == []
