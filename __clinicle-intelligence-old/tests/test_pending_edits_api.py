# encoding:utf-8
"""channel/web/api/pending_edits.py: the HTTP surface over
pending_edits_store.py. Approve actually runs the staged tool against a real
file in tmp_path; reject never touches the filesystem."""

import json
import os
import tempfile
from unittest.mock import patch

import pytest
import web

from agent.workspace import pending_edits_store


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(pending_edits_store, "_db_path", lambda org_id: tmp_path / "pending_edits.db")
    yield


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


def _patched(org_id="org1"):
    return (
        patch("channel.web.api.pending_edits.web.header"),
        patch("channel.web.api.pending_edits._require_auth"),
        patch("channel.web.api.pending_edits._org_id", return_value=org_id),
        patch("channel.web.api.pending_edits._current_user_id", return_value=7),
    )


def test_list_scopes_to_the_callers_org():
    pending_edits_store.create_pending_edit(
        org_id="org1", agent_id="a", session_id="s", tool_name="edit", arguments={},
    )
    pending_edits_store.create_pending_edit(
        org_id="org2", agent_id="a", session_id="s", tool_name="edit", arguments={},
    )
    from channel.web.api.pending_edits import PendingEditsHandler

    p1, p2, p3, p4 = _patched(org_id="org1")
    with p1, p2, p3, p4, \
         patch("channel.web.api.pending_edits.web.input", return_value=web.storage(status='', agent_id='')):
        response = json.loads(PendingEditsHandler().GET())

    assert len(response["pending_edits"]) == 1
    assert response["pending_edits"][0]["org_id"] == "org1"


def test_reject_marks_rejected_and_touches_nothing_on_disk():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "f.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write("x = 1\n")
        pending = pending_edits_store.create_pending_edit(
            org_id="org1", agent_id="a", session_id="s", tool_name="edit",
            arguments={"path": path, "oldText": "x = 1", "newText": "x = 2"}, cwd=work,
        )

        from channel.web.api.pending_edits import PendingEditActionHandler
        p1, p2, p3, p4 = _patched(org_id="org1")
        with p1, p2, p3, p4, \
             patch("channel.web.api.pending_edits.web.data", return_value=json.dumps({"action": "reject"}).encode()):
            response = json.loads(PendingEditActionHandler().POST(pending["id"]))

        assert response["pending_edit"]["status"] == "rejected"
        assert response["pending_edit"]["resolved_by_user_id"] == 7
        with open(path, encoding="utf-8") as f:
            assert f.read() == "x = 1\n"  # untouched


def test_approve_actually_applies_the_edit():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "f.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write("x = 1\n")
        pending = pending_edits_store.create_pending_edit(
            org_id="org1", agent_id="a", session_id="s", tool_name="edit",
            arguments={"path": path, "oldText": "x = 1", "newText": "x = 2"}, cwd=work,
        )

        from channel.web.api.pending_edits import PendingEditActionHandler
        p1, p2, p3, p4 = _patched(org_id="org1")
        with p1, p2, p3, p4, \
             patch("channel.web.api.pending_edits.web.data", return_value=json.dumps({"action": "approve"}).encode()):
            response = json.loads(PendingEditActionHandler().POST(pending["id"]))

        assert response["pending_edit"]["status"] == "approved"
        assert response["pending_edit"]["result"]["status"] == "success"
        with open(path, encoding="utf-8") as f:
            assert f.read() == "x = 2\n"


def test_approve_write_creates_the_file():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "new.txt")
        pending = pending_edits_store.create_pending_edit(
            org_id="org1", agent_id="a", session_id="s", tool_name="write",
            arguments={"path": path, "content": "hello\n"}, cwd=work,
        )

        from channel.web.api.pending_edits import PendingEditActionHandler
        p1, p2, p3, p4 = _patched(org_id="org1")
        with p1, p2, p3, p4, \
             patch("channel.web.api.pending_edits.web.data", return_value=json.dumps({"action": "approve"}).encode()):
            PendingEditActionHandler().POST(pending["id"])

        with open(path, encoding="utf-8") as f:
            assert f.read() == "hello\n"


def test_cannot_resolve_an_already_resolved_edit_twice():
    pending = pending_edits_store.create_pending_edit(
        org_id="org1", agent_id="a", session_id="s", tool_name="edit", arguments={"path": "x"},
    )
    pending_edits_store.resolve_pending_edit(pending["id"], "rejected", resolved_by_user_id=1)

    from channel.web.api.pending_edits import PendingEditActionHandler
    p1, p2, p3, p4 = _patched(org_id="org1")
    with p1, p2, p3, p4, \
         patch("channel.web.api.pending_edits.web.data", return_value=json.dumps({"action": "approve"}).encode()):
        response = json.loads(PendingEditActionHandler().POST(pending["id"]))

    assert response["status"] == "error"
    assert "already rejected" in response["message"]


def test_a_foreign_orgs_pending_edit_is_not_found_not_leaked():
    pending = pending_edits_store.create_pending_edit(
        org_id="org2", agent_id="a", session_id="s", tool_name="edit", arguments={},
    )
    from channel.web.api.pending_edits import PendingEditActionHandler
    p1, p2, p3, p4 = _patched(org_id="org1")  # different org than the edit's own
    with p1, p2, p3, p4, \
         patch("channel.web.api.pending_edits.web.data", return_value=json.dumps({"action": "approve"}).encode()):
        response = json.loads(PendingEditActionHandler().POST(pending["id"]))
    assert response["status"] == "error"
    assert web.ctx.status == "404 Not Found"


def test_invalid_action_is_rejected():
    pending = pending_edits_store.create_pending_edit(
        org_id="org1", agent_id="a", session_id="s", tool_name="edit", arguments={},
    )
    from channel.web.api.pending_edits import PendingEditActionHandler
    p1, p2, p3, p4 = _patched(org_id="org1")
    with p1, p2, p3, p4, \
         patch("channel.web.api.pending_edits.web.data", return_value=json.dumps({"action": "maybe"}).encode()):
        response = json.loads(PendingEditActionHandler().POST(pending["id"]))
    assert response["status"] == "error"
    assert web.ctx.status == "400 Bad Request"
