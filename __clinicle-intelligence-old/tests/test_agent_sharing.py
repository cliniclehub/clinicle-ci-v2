"""Agent sharing: ownership fields, the can_use_agent ACL, share_agent, and
the one-time legacy-ownership migration.

Mirrors agent/workspace/meeting_store.py's can_view ACL by design (see
agent/registry.py's can_use_agent docstring) -- these tests follow the same
shape test_meeting_store.py already proves for meetings.
"""

import json
from pathlib import Path

import pytest

from agent.admin import AgentAdminService
from agent import team
from agent.registry import AgentProfile, AgentRegistry, can_use_agent, set_agent_registry
from agent.tenancy.store import TenancyStore


def _pin(settings):
    set_agent_registry(AgentRegistry.from_config(team.resolve(settings)))


@pytest.fixture
def admin(tmp_path):
    primary = tmp_path / "primary"
    primary.mkdir()
    secondary = tmp_path / "secondary"
    secondary.mkdir()
    settings = {
        "agent_workspace": str(tmp_path),
        "default_agent_id": "primary",
        "agents": [
            {"id": "primary", "name": "Primary", "workspace": str(primary), "enabled": True},
            {"id": "secondary", "name": "Secondary", "workspace": str(secondary), "enabled": True},
        ],
        "channel_instances": [],
    }
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(settings), encoding="utf-8")
    _pin(settings)
    try:
        yield AgentAdminService(str(config_path)), tmp_path, config_path
    finally:
        set_agent_registry(None)


@pytest.fixture
def store(tmp_path):
    return TenancyStore(db_path=Path(tmp_path) / "platform.db")


BASE = dict(id="a", name="A", workspace="/tmp/a")


def _profile(**overrides):
    return AgentProfile(**{**BASE, **overrides})


# ---------------------------------------------------------------------------
# can_use_agent
# ---------------------------------------------------------------------------

def test_no_owner_is_unrestricted():
    """An Agent that predates ownership (or was never assigned one) stays
    visible to everyone, exactly today's behavior -- never silently private."""
    profile = _profile()
    assert can_use_agent(profile, user_id=999, is_org_admin=False)


def test_no_user_id_is_unrestricted():
    """A legacy no-account install has no per-user identity anywhere else in
    the app either -- user_id=None must mean unfiltered, same as
    meeting_store.can_view's None case."""
    profile = _profile(owner_user_id=1)
    assert can_use_agent(profile, user_id=None, is_org_admin=False)


def test_owner_can_use_own_agent():
    profile = _profile(owner_user_id=1)
    assert can_use_agent(profile, user_id=1, is_org_admin=False)


def test_org_admin_always_has_access():
    profile = _profile(owner_user_id=1)
    assert can_use_agent(profile, user_id=2, is_org_admin=True)


def test_visible_to_org_grants_any_org_member():
    profile = _profile(owner_user_id=1, visible_to_org=True)
    assert can_use_agent(profile, user_id=2, is_org_admin=False, is_org_member=True)


def test_visible_to_org_does_not_grant_a_non_member():
    """is_org_member must be resolved against THIS Agent's own org_id -- a
    caller who is a member of some OTHER org must not pass here. That
    resolution lives in the caller (channel/web/api/agents.py's
    _is_org_member(user_id, profile.org_id)); this only proves the flag
    itself doesn't grant anything without is_org_member=True."""
    profile = _profile(owner_user_id=1, visible_to_org=True)
    assert not can_use_agent(profile, user_id=2, is_org_admin=False, is_org_member=False)


def test_org_member_without_visible_to_org_is_still_denied():
    """Being in the same org is not enough by itself -- visible_to_org must
    be explicitly set, same opt-in-only rule as shared_with."""
    profile = _profile(owner_user_id=1)
    assert not can_use_agent(profile, user_id=2, is_org_admin=False, is_org_member=True)


def test_shared_user_can_use_it():
    profile = _profile(owner_user_id=1, shared_with=(2, 3))
    assert can_use_agent(profile, user_id=2, is_org_admin=False)
    assert can_use_agent(profile, user_id=3, is_org_admin=False)


def test_unrelated_user_is_denied():
    profile = _profile(owner_user_id=1, shared_with=(2,))
    assert not can_use_agent(profile, user_id=4, is_org_admin=False)


# ---------------------------------------------------------------------------
# create_agent / update_agent / share_agent
# ---------------------------------------------------------------------------

def test_create_agent_sets_owner_and_org(admin):
    service, root, _ = admin
    created = service.create_agent(
        "hire", "Hire", str(root / "hire"), owner_user_id=7, org_id="1",
    )
    assert created["owner_user_id"] == 7
    assert created["org_id"] == "1"


def test_update_agent_never_wipes_ownership_or_shares(admin):
    """Regression guard: update_agent used to rebuild AgentProfile without
    carrying owner_user_id/org_id/shared_with, which would silently strip
    sharing on any unrelated edit (e.g. a rename)."""
    service, root, _ = admin
    service.create_agent("hire", "Hire", str(root / "hire"), owner_user_id=7, org_id="1")
    service.share_agent("hire", [8, 9])

    updated = service.update_agent("hire", name="Renamed")

    assert updated["owner_user_id"] == 7
    assert updated["org_id"] == "1"
    assert set(updated["shared_with"]) == {8, 9}


def test_update_agent_sets_visible_to_org(admin):
    service, root, _ = admin
    service.create_agent("hire", "Hire", str(root / "hire"), owner_user_id=7, org_id="1")

    updated = service.update_agent("hire", visible_to_org=True)

    assert updated["visible_to_org"] is True


def test_update_agent_preserves_visible_to_org_on_unrelated_edit(admin):
    service, root, _ = admin
    service.create_agent("hire", "Hire", str(root / "hire"), owner_user_id=7, org_id="1")
    service.update_agent("hire", visible_to_org=True)

    updated = service.update_agent("hire", name="Renamed")

    assert updated["visible_to_org"] is True


def test_share_agent_fully_replaces_the_list(admin):
    service, root, _ = admin
    service.create_agent("hire", "Hire", str(root / "hire"), owner_user_id=7)
    service.share_agent("hire", [1, 2, 3])

    replaced = service.share_agent("hire", [3, 4])

    assert set(replaced["shared_with"]) == {3, 4}


def test_share_agent_persists_across_reload(admin):
    service, root, config_path = admin
    service.create_agent("hire", "Hire", str(root / "hire"), owner_user_id=7)
    service.share_agent("hire", [1, 2])

    reloaded = AgentAdminService(str(config_path)).snapshot()
    hire = next(a for a in reloaded["agents"] if a["id"] == "hire")
    assert set(hire["shared_with"]) == {1, 2}


# ---------------------------------------------------------------------------
# migrate_legacy_ownership
# ---------------------------------------------------------------------------

def test_migration_assigns_single_org_owner(admin, store, monkeypatch):
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)
    org = store.create_organization("Acme")
    owner = store.create_user("owner@acme.com", "password123")
    store.add_membership(owner.id, org.id, role="owner")

    service, _, _ = admin
    service.migrate_legacy_ownership()

    snapshot = service.snapshot()
    for agent in snapshot["agents"]:
        assert agent["owner_user_id"] == owner.id
        assert agent["org_id"] == str(org.id)


def test_migration_is_idempotent(admin, store, monkeypatch):
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)
    org = store.create_organization("Acme")
    owner = store.create_user("owner@acme.com", "password123")
    store.add_membership(owner.id, org.id, role="owner")

    service, _, _ = admin
    service.migrate_legacy_ownership()
    service.share_agent("primary", [42])  # a real post-migration edit
    service.migrate_legacy_ownership()  # must not touch already-owned Agents

    snapshot = service.snapshot()
    primary = next(a for a in snapshot["agents"] if a["id"] == "primary")
    assert set(primary["shared_with"]) == {42}


def test_migration_skips_no_account_install(admin, store, monkeypatch):
    """has_any_user() is False -- no org concept exists anywhere else in the
    app either, so nothing should be assigned an owner."""
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)

    service, _, _ = admin
    service.migrate_legacy_ownership()

    snapshot = service.snapshot()
    assert all(a.get("owner_user_id") is None for a in snapshot["agents"])


def test_migration_skips_multi_org_instance(admin, store, monkeypatch):
    """More than one org and a pre-existing Agent has no org_id of its own to
    tell them apart by -- must not guess, must leave every Agent unrestricted
    for a human to assign by hand."""
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)
    org_a = store.create_organization("Acme")
    org_b = store.create_organization("Globex")
    owner_a = store.create_user("owner-a@acme.com", "password123")
    store.add_membership(owner_a.id, org_a.id, role="owner")
    store.create_user("owner-b@globex.com", "password123")
    store.add_membership(store.get_user_by_email("owner-b@globex.com").id, org_b.id, role="owner")

    service, _, _ = admin
    service.migrate_legacy_ownership()

    snapshot = service.snapshot()
    assert all(a.get("owner_user_id") is None for a in snapshot["agents"])
