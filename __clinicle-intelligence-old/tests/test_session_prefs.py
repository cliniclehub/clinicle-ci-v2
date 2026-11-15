# encoding:utf-8
"""Guard session_prefs's merge onto team_store: model/permission overrides
still live in session_prefs.json exactly as before, but `members` -- the
composer's "invite a teammate into this chat" roster -- now delegates to
team_store as a "shared" team (agent.workspace.team_store's shared-session
section). Every one of session_prefs's callers across the codebase only
ever goes through get_prefs/set_prefs/members_index/forget_agent, so this
file's job is to prove those four keep behaving exactly as they did when
`members` lived in the local JSON.
"""

import pytest

from agent.workspace import session_prefs, team_store


@pytest.fixture(autouse=True)
def isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(session_prefs, "_store_file", lambda: str(tmp_path / "session_prefs.json"))
    monkeypatch.setattr(team_store, "_store_file", lambda: str(tmp_path / "teams.json"))


def test_model_and_permission_are_unaffected_by_the_merge():
    session_prefs.set_prefs("s1", agent_id="primary", model="claude-sonnet-5", permission="workspace-write")
    prefs = session_prefs.get_prefs("s1", agent_id="primary")
    assert prefs["model"] == "claude-sonnet-5"
    assert prefs["permission"] == "workspace-write"
    assert "members" not in prefs


def test_members_round_trip_through_team_store():
    session_prefs.set_prefs("s1", agent_id="primary", members=["writer", "researcher"])
    prefs = session_prefs.get_prefs("s1", agent_id="primary")
    assert prefs["members"] == ["writer", "researcher"]
    # And it really did land in team_store, not a local members field.
    shared = [t for t in team_store.list_teams() if t.get("session_mode") == "shared"]
    assert len(shared) == 1
    assert shared[0]["members"][0]["agent_id"] == "primary"
    assert shared[0]["members"][0]["role"] == "leader"


def test_clearing_members_deletes_the_shared_team():
    session_prefs.set_prefs("s1", agent_id="primary", members=["writer"])
    session_prefs.set_prefs("s1", agent_id="primary", members=None)
    assert "members" not in session_prefs.get_prefs("s1", agent_id="primary")
    assert not [t for t in team_store.list_teams() if t.get("session_mode") == "shared"]


def test_model_only_update_does_not_disturb_an_existing_roster():
    session_prefs.set_prefs("s1", agent_id="primary", members=["writer"])
    session_prefs.set_prefs("s1", agent_id="primary", model="gpt-5")
    prefs = session_prefs.get_prefs("s1", agent_id="primary")
    assert prefs["members"] == ["writer"]
    assert prefs["model"] == "gpt-5"


def test_members_index_reads_through_to_team_store():
    session_prefs.set_prefs("s1", agent_id="primary", members=["writer"])
    session_prefs.set_prefs("s2", agent_id="primary", model="gpt-5")  # no roster
    index = session_prefs.members_index()
    assert index.get(("primary", "s1")) == ["writer"]
    assert ("primary", "s2") not in index


def test_forget_agent_prunes_own_shared_teams_and_ghost_memberships():
    session_prefs.set_prefs("s1", agent_id="research", model="claude-sonnet-5")  # own override
    session_prefs.set_prefs("s2", agent_id="primary", members=["research", "writer"])  # ghost membership
    session_prefs.set_prefs("s3", agent_id="research", members=["writer"])  # research's own shared team

    session_prefs.forget_agent("research")

    assert session_prefs.get_prefs("s1", agent_id="research") == {}
    assert session_prefs.get_prefs("s2", agent_id="primary")["members"] == ["writer"]
    assert "members" not in session_prefs.get_prefs("s3", agent_id="research")


def test_legacy_local_members_are_migrated_on_first_read(tmp_path):
    # Simulate a row saved before this merge: `members` sitting in the local
    # JSON directly, the way session_prefs used to store it.
    import json
    import time

    path = tmp_path / "session_prefs.json"
    path.write_text(json.dumps({
        "sessions": {
            "primary::s1": {"model": "claude-sonnet-5", "members": ["writer"], "ts": time.time()}
        }
    }))

    prefs = session_prefs.get_prefs("s1", agent_id="primary")
    assert prefs["members"] == ["writer"]
    assert prefs["model"] == "claude-sonnet-5"

    # Migrated into team_store...
    shared = [t for t in team_store.list_teams() if t.get("session_mode") == "shared"]
    assert len(shared) == 1
    # ...and the local row no longer carries the old field.
    raw = json.loads(path.read_text())
    assert "members" not in raw["sessions"]["primary::s1"]
    assert raw["sessions"]["primary::s1"]["model"] == "claude-sonnet-5"
