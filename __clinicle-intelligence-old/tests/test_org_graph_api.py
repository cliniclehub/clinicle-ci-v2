# encoding:utf-8
"""channel/web/api/org_graph.py: the HTTP surface over org_graph.py/team_store's
org-tagging. Same patching convention as test_tenancy_api.py -- these tests
stand in for the acting user's own resolved (user_id, org_id), never a value
from the request, mirroring what _require_membership actually enforces."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
import web

from agent.tenancy.store import TenancyStore
from agent.workspace import project_store, team_store


@pytest.fixture(autouse=True)
def isolated_team_store(tmp_path, monkeypatch):
    path = tmp_path / "teams.json"
    monkeypatch.setattr(team_store, "_store_file", lambda: str(path))
    monkeypatch.setattr(project_store, "_store_file", lambda: str(tmp_path / "projects.json"))
    yield path


@pytest.fixture
def store(tmp_path):
    return TenancyStore(db_path=Path(tmp_path) / "platform.db")


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


@pytest.fixture
def org_with_admin_and_member(store):
    org = store.create_organization("Acme")
    admin = store.create_user("admin@example.com", "password123")
    member = store.create_user("member@example.com", "password123")
    store.add_membership(admin.id, org.id, role="admin", actor="admin@example.com")
    store.add_membership(member.id, org.id, role="member", actor="admin@example.com")
    return org, admin, member


def _patched_graph(store, acting_user_id, org_id):
    # Two patch targets for one fake store: _require_membership (defined in
    # tenancy.py) resolves get_tenancy_store from ITS OWN module namespace
    # (bound at tenancy.py's import time), while OrgGraphHandler.GET does its
    # own fresh `from agent.tenancy.store import get_tenancy_store` for the
    # has_any_user/get_organization calls -- same two-target pattern
    # test_tenancy_api.py uses for _require_membership alone.
    return (
        patch("channel.web.api.org_graph.web.header"),
        patch("channel.web.api.tenancy.get_tenancy_store", return_value=store),
        patch("agent.tenancy.store.get_tenancy_store", return_value=store),
        patch("channel.web.api.tenancy._current_user_and_org", return_value=(acting_user_id, org_id)),
        # _require_membership(capability=...) additionally routes through
        # _common._require_capability, which resolves identity via ITS OWN
        # separate _current_user_and_org (needs a real WSGI environ this
        # test process never sets up) -- pre-existing gap, same one that
        # already fails test_tenancy_api.py's own capability-gated tests
        # (test_admin_can_remove_a_member etc.) independent of anything here.
        # Worked around locally rather than fixed, since it is not this
        # feature's to fix.
        patch("channel.web.core._common._current_user_and_org", return_value=(acting_user_id, org_id)),
    )


def test_graph_scopes_to_the_callers_own_org(store, org_with_admin_and_member):
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgGraphHandler

    team_store.create_team("mine", [{"agent_id": "boss", "role": "leader"}], org_id=org.id)
    team_store.create_team("theirs", [{"agent_id": "boss", "role": "leader"}], org_id=org.id + 999)

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5:
        response = json.loads(OrgGraphHandler().GET())

    assert response["applicable"] is True
    team_labels = {n["label"] for n in response["nodes"] if n["type"] == "team"}
    assert team_labels == {"mine"}


def test_graph_on_legacy_no_account_install_is_not_applicable():
    from channel.web.api.org_graph import OrgGraphHandler

    with patch("channel.web.api.org_graph.web.header"), \
         patch("agent.tenancy.store.get_tenancy_store") as mock_get_store:
        mock_get_store.return_value.has_any_user.return_value = False
        response = json.loads(OrgGraphHandler().GET())

    assert response == {"status": "success", "nodes": [], "edges": [], "applicable": False}


def test_non_admin_cannot_link_a_team_to_the_org(store, org_with_admin_and_member):
    org, _admin, member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])

    p1, p2, p3, p4, p5 = _patched_graph(store, member.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": True}).encode()):
        with pytest.raises(Exception) as exc_info:
            OrgTeamAssignHandler().POST(team["id"])

    assert "403" in str(exc_info.value)
    assert team_store.get_team(team["id"])["org_id"] is None


def test_admin_links_and_unlinks_a_team_to_their_own_org_only(store, org_with_admin_and_member):
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": True}).encode()):
        response = json.loads(OrgTeamAssignHandler().POST(team["id"]))
    assert response["status"] == "success"
    assert team_store.get_team(team["id"])["org_id"] == org.id

    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": False}).encode()):
        OrgTeamAssignHandler().POST(team["id"])
    assert team_store.get_team(team["id"])["org_id"] is None


def test_linking_a_team_already_owned_by_another_org_is_a_409(store, org_with_admin_and_member):
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}], org_id=org.id + 999)

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": True}).encode()):
        response = json.loads(OrgTeamAssignHandler().POST(team["id"]))

    assert response["status"] == "error"
    assert response["code"] == "org_contention"
    # Never silently moved -- still belongs to the other org.
    assert team_store.get_team(team["id"])["org_id"] == org.id + 999


def test_force_true_overrides_the_contention_and_moves_the_team(store, org_with_admin_and_member):
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}], org_id=org.id + 999)

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": True, "force": True}).encode()):
        response = json.loads(OrgTeamAssignHandler().POST(team["id"]))

    assert response["status"] == "success"
    assert team_store.get_team(team["id"])["org_id"] == org.id


def test_unlinking_never_triggers_contention_regardless_of_force(store, org_with_admin_and_member):
    """Contention only guards *linking* into your own org -- unlinking (which
    this endpoint's own docstring already scopes to the caller's org id via
    set_team_org(team_id, None)) never needs it."""
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}], org_id=org.id)

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": False}).encode()):
        response = json.loads(OrgTeamAssignHandler().POST(team["id"]))

    assert response["status"] == "success"
    assert team_store.get_team(team["id"])["org_id"] is None


def test_relinking_a_team_already_in_your_own_org_is_not_contention(store, org_with_admin_and_member):
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}], org_id=org.id)

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": True}).encode()):
        response = json.loads(OrgTeamAssignHandler().POST(team["id"]))

    assert response["status"] == "success"


def test_linking_an_unknown_team_id_is_404(store, org_with_admin_and_member):
    org, admin, _member = org_with_admin_and_member
    from channel.web.api.org_graph import OrgTeamAssignHandler

    p1, p2, p3, p4, p5 = _patched_graph(store, admin.id, org.id)
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.org_graph.web.data", return_value=json.dumps({"linked": True}).encode()):
        with pytest.raises(Exception) as exc_info:
            OrgTeamAssignHandler().POST("does-not-exist")
    assert "404" in str(exc_info.value)
