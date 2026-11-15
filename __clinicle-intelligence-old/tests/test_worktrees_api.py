# encoding:utf-8
"""channel/web/api/worktrees.py: the HTTP surface over
agent/subagent/worktree.py's merge-back queue."""

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
import web

from agent.subagent import worktree as worktree_module
from channel.web.api.worktrees import (
    WorktreeActionHandler, WorktreeCompleteHandler, WorktreeConflictsHandler,
    WorktreeResolveBinaryHandler, WorktreeResolveHandler, WorktreesHandler,
)


def _init_repo(path: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=path, check=True)
    (path / "README.md").write_text("hello\n")
    subprocess.run(["git", "add", "."], cwd=path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=path, check=True)


@pytest.fixture(autouse=True)
def isolated_registry(tmp_path, monkeypatch):
    monkeypatch.setattr(worktree_module, "_REGISTRY_PATH", tmp_path / "pending_worktrees.json")
    yield


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


def _patched():
    return (
        patch("channel.web.api.worktrees.web.header"),
        patch("channel.web.api.worktrees._require_auth"),
    )


def test_list_returns_the_pending_queue(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    wt = worktree_module.create_worktree(str(repo), "task-1")
    entry = worktree_module.register_pending_worktree(
        worktree_path=wt, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )

    p1, p2 = _patched()
    with p1, p2:
        response = json.loads(WorktreesHandler().GET())

    assert response["status"] == "success"
    assert [w["id"] for w in response["worktrees"]] == [entry["id"]]
    worktree_module.discard_worktree(entry["id"])


def test_merge_action_applies_the_branch(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    wt = worktree_module.create_worktree(str(repo), "task-1")
    (Path(wt) / "new.txt").write_text("x")
    subprocess.run(["git", "add", "."], cwd=wt, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "work"], cwd=wt, check=True)
    entry = worktree_module.register_pending_worktree(
        worktree_path=wt, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )

    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"action": "merge"})):
        response = json.loads(WorktreeActionHandler().POST(entry["id"]))

    assert response["status"] == "success"
    assert (repo / "new.txt").exists()
    assert response["worktrees"] == []


def test_discard_action_drops_the_branch_without_merging(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    wt = worktree_module.create_worktree(str(repo), "task-1")
    (Path(wt) / "new.txt").write_text("x")
    entry = worktree_module.register_pending_worktree(
        worktree_path=wt, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )

    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"action": "discard"})):
        response = json.loads(WorktreeActionHandler().POST(entry["id"]))

    assert response["status"] == "success"
    assert not (repo / "new.txt").exists()
    assert not Path(wt).exists()


def test_invalid_action_is_rejected():
    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"action": "delete"})):
        response = json.loads(WorktreeActionHandler().POST("wt_whatever"))

    assert response["status"] == "error"


def test_action_on_an_unknown_id_returns_an_error():
    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"action": "merge"})):
        response = json.loads(WorktreeActionHandler().POST("wt_nope"))

    assert response["status"] == "error"


# =========================================================================
# Merge-conflict resolution: merge action surfaces conflict=true instead of
# auto-aborting, and the new conflicts/resolve/complete/abort endpoints
# drive the rest of the bounded v1 flow.
# =========================================================================

def _make_conflicting_entry(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    wt = worktree_module.create_worktree(str(repo), "task-1")
    (Path(wt) / "README.md").write_text("sub agent's version\n")
    subprocess.run(["git", "add", "."], cwd=wt, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "sub agent edits README"], cwd=wt, check=True)
    (repo / "README.md").write_text("meanwhile, on main\n")
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "main moves on"], cwd=repo, check=True)
    entry = worktree_module.register_pending_worktree(
        worktree_path=wt, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    return repo, wt, entry


def test_merge_action_surfaces_conflict_flag_instead_of_aborting(tmp_path):
    repo, wt, entry = _make_conflicting_entry(tmp_path)

    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"action": "merge"})):
        response = json.loads(WorktreeActionHandler().POST(entry["id"]))

    assert response["status"] == "error"
    assert response["conflict"] is True

    worktree_module.abort_merge_conflict(entry["id"])
    worktree_module.discard_worktree(entry["id"])


def test_conflicts_handler_returns_parsed_hunks(tmp_path):
    repo, wt, entry = _make_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    with p1, p2:
        response = json.loads(WorktreeConflictsHandler().GET(entry["id"]))

    assert response["status"] == "success"
    assert list(response["files"].keys()) == ["README.md"]

    worktree_module.abort_merge_conflict(entry["id"])
    worktree_module.discard_worktree(entry["id"])


def test_resolve_handler_requires_path_and_resolutions_list(tmp_path):
    repo, wt, entry = _make_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"path": "README.md"})):
        response = json.loads(WorktreeResolveHandler().POST(entry["id"]))

    assert response["status"] == "error"

    worktree_module.abort_merge_conflict(entry["id"])
    worktree_module.discard_worktree(entry["id"])


def test_resolve_then_complete_finishes_the_merge(tmp_path):
    repo, wt, entry = _make_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    body = json.dumps({"path": "README.md", "resolutions": ["theirs"]})
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=body):
        resolve_response = json.loads(WorktreeResolveHandler().POST(entry["id"]))
    assert resolve_response["status"] == "success"

    with p1, p2:
        complete_response = json.loads(WorktreeCompleteHandler().POST(entry["id"]))

    assert complete_response["status"] == "success"
    assert (repo / "README.md").read_text() == "sub agent's version\n"
    assert complete_response["worktrees"] == []


def test_abort_action_restores_a_clean_repo(tmp_path):
    repo, wt, entry = _make_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"action": "abort"})):
        response = json.loads(WorktreeActionHandler().POST(entry["id"]))

    assert response["status"] == "success"
    status = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True)
    assert status.stdout.strip() == ""

    worktree_module.discard_worktree(entry["id"])


def _make_binary_conflicting_entry(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    wt = worktree_module.create_worktree(str(repo), "task-1")
    (Path(wt) / "asset.bin").write_bytes(b"\x00\x01SUBAGENT\x02\x00")
    subprocess.run(["git", "add", "."], cwd=wt, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "sub agent edits binary"], cwd=wt, check=True)
    (repo / "asset.bin").write_bytes(b"\x00\x01MAIN\x02\x00")
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "main moves on"], cwd=repo, check=True)
    entry = worktree_module.register_pending_worktree(
        worktree_path=wt, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    return repo, wt, entry


def test_conflicts_handler_reports_a_binary_file_distinctly(tmp_path):
    repo, wt, entry = _make_binary_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    with p1, p2:
        response = json.loads(WorktreeConflictsHandler().GET(entry["id"]))

    assert response["files"]["asset.bin"] == {"binary": True}

    worktree_module.abort_merge_conflict(entry["id"])
    worktree_module.discard_worktree(entry["id"])


def test_resolve_binary_handler_requires_path_and_a_valid_choice(tmp_path):
    repo, wt, entry = _make_binary_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=json.dumps({"path": "asset.bin", "choice": "sideways"})):
        response = json.loads(WorktreeResolveBinaryHandler().POST(entry["id"]))

    assert response["status"] == "error"

    worktree_module.abort_merge_conflict(entry["id"])
    worktree_module.discard_worktree(entry["id"])


def test_resolve_binary_handler_keeps_theirs_and_completes(tmp_path):
    repo, wt, entry = _make_binary_conflicting_entry(tmp_path)
    worktree_module.merge_worktree(entry["id"])

    p1, p2 = _patched()
    body = json.dumps({"path": "asset.bin", "choice": "theirs"})
    with p1, p2, patch("channel.web.api.worktrees.web.data", return_value=body):
        resolve_response = json.loads(WorktreeResolveBinaryHandler().POST(entry["id"]))
    assert resolve_response["status"] == "success"

    with p1, p2:
        complete_response = json.loads(WorktreeCompleteHandler().POST(entry["id"]))

    assert complete_response["status"] == "success"
    assert (repo / "asset.bin").read_bytes() == b"\x00\x01SUBAGENT\x02\x00"
