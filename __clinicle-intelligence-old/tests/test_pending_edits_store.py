# encoding:utf-8
"""agent/workspace/pending_edits_store.py: staged edit/write calls awaiting
a human Accept/Reject. Isolated by monkeypatching _db_path directly rather
than shared_root/RuntimeIdentity plumbing -- this store's only external
dependency."""

import pytest

from agent.workspace import pending_edits_store as store


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_db_path", lambda org_id: tmp_path / "pending_edits.db")
    yield


@pytest.fixture
def isolated_multi_org_db(tmp_path, monkeypatch):
    """A real per-org file split (org 'a' and org 'b' get DIFFERENT files),
    unlike isolated_db's one-file-for-everyone shortcut -- the shortcut hides
    exactly the class of bug this fixture exists to catch: a function that
    forgets to thread org_id through one of its own internal calls and
    silently falls back to the wrong org's file (found live: resolve_pending_edit's
    own final `get_pending_edit` call once did this)."""
    monkeypatch.setattr(store, "_db_path", lambda org_id: tmp_path / f"pending_edits_{org_id or 'default'}.db")
    yield


def test_create_and_get_round_trips_everything():
    created = store.create_pending_edit(
        org_id=None, agent_id="doctor", session_id="s1", tool_name="edit",
        arguments={"path": "a.py", "oldText": "x", "newText": "y"},
        diff="--- a\n+++ b\n", path="a.py", run_id="r1", tool_call_id="tc1",
    )
    assert created["status"] == "pending"
    assert created["tool_name"] == "edit"
    assert created["arguments"] == {"path": "a.py", "oldText": "x", "newText": "y"}

    fetched = store.get_pending_edit(created["id"])
    assert fetched == created


def test_create_rejects_a_non_gated_tool_name():
    with pytest.raises(ValueError):
        store.create_pending_edit(
            org_id=None, agent_id="a", session_id="s", tool_name="bash", arguments={},
        )


def test_get_unknown_id_returns_none():
    assert store.get_pending_edit("does-not-exist") is None


def test_list_pending_edits_scopes_by_status_and_agent():
    store.create_pending_edit(org_id=None, agent_id="a", session_id="s", tool_name="edit", arguments={})
    b = store.create_pending_edit(org_id=None, agent_id="b", session_id="s", tool_name="write", arguments={})
    store.resolve_pending_edit(b["id"], "approved", resolved_by_user_id=1)

    pending_only = store.list_pending_edits(None, status="pending")
    assert {p["agent_id"] for p in pending_only} == {"a"}

    for_b = store.list_pending_edits(None, agent_id="b")
    assert [p["id"] for p in for_b] == [b["id"]]


def test_list_pending_edits_puts_pending_first():
    old_resolved = store.create_pending_edit(org_id=None, agent_id="a", session_id="s", tool_name="edit", arguments={})
    store.resolve_pending_edit(old_resolved["id"], "rejected", resolved_by_user_id=1)
    new_pending = store.create_pending_edit(org_id=None, agent_id="a", session_id="s", tool_name="edit", arguments={})

    ordered = store.list_pending_edits(None)
    assert ordered[0]["id"] == new_pending["id"]


def test_resolve_approved_stores_the_actual_execution_result():
    created = store.create_pending_edit(
        org_id=None, agent_id="a", session_id="s", tool_name="write", arguments={"path": "x", "content": "y"},
    )
    resolved = store.resolve_pending_edit(
        created["id"], "approved", resolved_by_user_id=42,
        result={"status": "success", "result": {"message": "wrote it"}},
        note="looks fine",
    )
    assert resolved["status"] == "approved"
    assert resolved["resolved_by_user_id"] == 42
    assert resolved["resolution_note"] == "looks fine"
    assert resolved["result"]["result"]["message"] == "wrote it"


def test_resolve_rejects_an_already_resolved_edit():
    """The same atomic-claim shape as conversation_store's claim_stale_run:
    WHERE status='pending' means a second resolve can never silently
    overwrite the first human's decision."""
    created = store.create_pending_edit(org_id=None, agent_id="a", session_id="s", tool_name="edit", arguments={})
    store.resolve_pending_edit(created["id"], "approved", resolved_by_user_id=1)

    second = store.resolve_pending_edit(created["id"], "rejected", resolved_by_user_id=2)
    # get_pending_edit still finds the row (it exists), but the UPDATE's own
    # WHERE clause silently no-ops when status is no longer 'pending' -- the
    # row keeps the FIRST resolution.
    assert second["status"] == "approved"
    assert second["resolved_by_user_id"] == 1


def test_resolve_unknown_id_returns_none():
    assert store.resolve_pending_edit("nope", "approved", resolved_by_user_id=1) is None


def test_resolve_rejects_an_invalid_status():
    created = store.create_pending_edit(org_id=None, agent_id="a", session_id="s", tool_name="edit", arguments={})
    with pytest.raises(ValueError):
        store.resolve_pending_edit(created["id"], "maybe", resolved_by_user_id=1)


# =====================================================================
# Real multi-org file separation -- found live: resolve_pending_edit's own
# final get_pending_edit call once forgot org_id and silently returned None
# for a successfully-resolved edit in any org but the ambiguous default.
# =====================================================================

def test_resolve_returns_the_updated_row_in_a_real_multi_org_install(isolated_multi_org_db):
    created = store.create_pending_edit(
        org_id="org-a", agent_id="a", session_id="s", tool_name="edit", arguments={"path": "x"},
    )
    resolved = store.resolve_pending_edit(
        created["id"], "approved", resolved_by_user_id=7, org_id="org-a",
        result={"status": "success", "result": {"message": "ok"}},
    )
    assert resolved is not None, (
        "resolve_pending_edit must return the updated row for the org it was "
        "given, not None -- a None here means it fell back to the wrong org's file"
    )
    assert resolved["status"] == "approved"
    assert resolved["resolved_by_user_id"] == 7


def test_resolve_in_one_org_never_touches_another_orgs_file(isolated_multi_org_db):
    org_a = store.create_pending_edit(org_id="org-a", agent_id="a", session_id="s", tool_name="edit", arguments={})
    org_b = store.create_pending_edit(org_id="org-b", agent_id="a", session_id="s", tool_name="edit", arguments={})

    store.resolve_pending_edit(org_a["id"], "approved", resolved_by_user_id=1, org_id="org-a")

    # org-b's own file is untouched -- its edit is still pending.
    assert store.get_pending_edit(org_b["id"], org_id="org-b")["status"] == "pending"
    assert store.list_pending_edits("org-b")[0]["status"] == "pending"
