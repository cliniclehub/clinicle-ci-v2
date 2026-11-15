# encoding:utf-8
"""agent/subagent/worktree.py: create/remove a git worktree for one sub agent
task. Exercises real git, not mocks -- worktree lifecycle is exactly the
kind of thing that looks right and isn't."""

import subprocess
from pathlib import Path

import pytest

from agent.subagent import worktree as worktree_module
from agent.subagent.worktree import create_worktree, remove_worktree


def _init_repo(path: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=path, check=True)
    (path / "README.md").write_text("hello\n")
    subprocess.run(["git", "add", "."], cwd=path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=path, check=True)


def test_create_worktree_returns_a_distinct_directory(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)

    worktree = create_worktree(str(repo), "task-1")
    try:
        assert worktree is not None
        assert Path(worktree) != repo
        assert Path(worktree).is_dir()
        # The isolated checkout actually has the repo's committed content.
        assert (Path(worktree) / "README.md").read_text() == "hello\n"
    finally:
        remove_worktree(str(repo), worktree)


def test_two_worktrees_for_the_same_repo_are_independent(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)

    w1 = create_worktree(str(repo), "task-1")
    w2 = create_worktree(str(repo), "task-2")
    try:
        assert w1 != w2
        (Path(w1) / "only-in-w1.txt").write_text("x")
        assert not (Path(w2) / "only-in-w1.txt").exists()
    finally:
        remove_worktree(str(repo), w1)
        remove_worktree(str(repo), w2)


def test_remove_worktree_actually_removes_the_directory(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)

    worktree = create_worktree(str(repo), "task-1")
    assert Path(worktree).is_dir()
    remove_worktree(str(repo), worktree)
    assert not Path(worktree).exists()


def test_non_git_directory_returns_none_not_an_exception(tmp_path):
    plain = tmp_path / "not-a-repo"
    plain.mkdir()
    assert create_worktree(str(plain), "task-1") is None


def test_empty_project_dir_returns_none():
    assert create_worktree("", "task-1") is None


def test_remove_worktree_with_no_path_is_a_noop():
    remove_worktree("/some/repo", "")  # must not raise
    remove_worktree("/some/repo", None)  # must not raise


# =====================================================================
# Merge-back queue: has_changes / register / list / merge / discard / sweep.
# =====================================================================

@pytest.fixture
def isolated_registry(tmp_path, monkeypatch):
    monkeypatch.setattr(worktree_module, "_REGISTRY_PATH", tmp_path / "pending_worktrees.json")
    yield


def test_has_changes_is_false_for_a_freshly_created_worktree(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    try:
        assert worktree_module.has_changes(worktree) is False
    finally:
        remove_worktree(str(repo), worktree)


def test_has_changes_is_true_for_an_uncommitted_edit(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    try:
        (Path(worktree) / "README.md").write_text("changed\n")
        assert worktree_module.has_changes(worktree) is True
    finally:
        remove_worktree(str(repo), worktree)


def test_has_changes_is_true_for_a_commit_the_task_made_itself(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    try:
        (Path(worktree) / "new.txt").write_text("x")
        subprocess.run(["git", "add", "."], cwd=worktree, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "sub agent commit"], cwd=worktree, check=True)
        assert worktree_module.has_changes(worktree) is True
    finally:
        remove_worktree(str(repo), worktree)


def test_register_list_and_discard_round_trip(isolated_registry, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    entry = worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1",
        run_id="task-1", task_name="researcher", agent_id="default",
    )
    listed = worktree_module.list_pending_worktrees()
    assert [e["id"] for e in listed] == [entry["id"]]

    result = worktree_module.discard_worktree(entry["id"])
    assert result["ok"] is True
    assert worktree_module.list_pending_worktrees() == []
    assert not Path(worktree).exists()


def test_merge_folds_the_branch_into_the_project(isolated_registry, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    (Path(worktree) / "new.txt").write_text("from the sub agent\n")
    subprocess.run(["git", "add", "."], cwd=worktree, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "sub agent work"], cwd=worktree, check=True)

    entry = worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    result = worktree_module.merge_worktree(entry["id"])

    assert result["ok"] is True
    assert (repo / "new.txt").read_text() == "from the sub agent\n"
    assert worktree_module.list_pending_worktrees() == []
    assert not Path(worktree).exists()


def _make_conflicting_merge(isolated_registry, tmp_path):
    """Sets up a repo/worktree pair where merge_worktree will hit a real
    git conflict on README.md, and registers the pending entry. Returns
    (repo, worktree, entry)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    (Path(worktree) / "README.md").write_text("sub agent's version\n")
    subprocess.run(["git", "add", "."], cwd=worktree, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "sub agent edits README"], cwd=worktree, check=True)
    # A conflicting edit lands on the project's own branch in the meantime.
    (repo / "README.md").write_text("meanwhile, on main\n")
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "main moves on"], cwd=repo, check=True)

    entry = worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    return repo, worktree, entry


def test_merge_conflict_is_left_in_progress_not_auto_aborted(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)

    result = worktree_module.merge_worktree(entry["id"])

    assert result["ok"] is False
    assert result["conflict"] is True
    # The repo is left MID-MERGE (conflict markers present), not cleaned up.
    status = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True)
    assert "UU README.md" in status.stdout
    assert (repo / "README.md").read_text().count("<<<<<<<") == 1
    # The entry is flagged as conflicted, still present, worktree untouched.
    listed = worktree_module.list_pending_worktrees()
    assert [e["id"] for e in listed] == [entry["id"]]
    assert listed[0]["merge_conflict"] is True
    assert Path(worktree).exists()

    worktree_module.abort_merge_conflict(entry["id"])
    remove_worktree(str(repo), worktree)


def test_abort_merge_conflict_restores_a_clean_repo(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.abort_merge_conflict(entry["id"])

    assert result["ok"] is True
    status = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True)
    assert status.stdout.strip() == ""
    assert worktree_module.list_pending_worktrees()[0]["merge_conflict"] is False

    remove_worktree(str(repo), worktree)


def test_get_merge_conflicts_lists_and_parses_the_conflicting_file(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.get_merge_conflicts(entry["id"])

    assert result["ok"] is True
    assert list(result["files"].keys()) == ["README.md"]
    blocks = result["files"]["README.md"]
    conflict_blocks = [b for b in blocks if b["type"] == "conflict"]
    assert len(conflict_blocks) == 1
    assert conflict_blocks[0]["ours"] == "meanwhile, on main"
    assert conflict_blocks[0]["theirs"] == "sub agent's version"

    worktree_module.abort_merge_conflict(entry["id"])
    remove_worktree(str(repo), worktree)


def test_get_merge_conflicts_without_a_conflict_in_progress_errors(isolated_registry, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    entry = worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    result = worktree_module.get_merge_conflicts(entry["id"])
    assert result["ok"] is False
    remove_worktree(str(repo), worktree)


def test_resolve_conflict_hunks_ours_and_complete_merge_commits_it(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    resolve_result = worktree_module.resolve_conflict_hunks(entry["id"], "README.md", ["theirs"])
    assert resolve_result["ok"] is True
    status = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], cwd=repo, capture_output=True, text=True)
    assert status.stdout.strip() == ""

    complete_result = worktree_module.complete_merge(entry["id"])
    assert complete_result["ok"] is True
    assert (repo / "README.md").read_text() == "sub agent's version\n"
    assert worktree_module.list_pending_worktrees() == []
    assert not Path(worktree).exists()


def test_resolve_conflict_hunks_manual_text_replaces_the_hunk(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    worktree_module.resolve_conflict_hunks(entry["id"], "README.md", ["merged by hand"])
    worktree_module.complete_merge(entry["id"])

    assert (repo / "README.md").read_text() == "merged by hand\n"


def test_resolve_conflict_hunks_rejects_a_resolution_count_mismatch(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.resolve_conflict_hunks(entry["id"], "README.md", ["ours", "theirs"])
    assert result["ok"] is False

    worktree_module.abort_merge_conflict(entry["id"])
    remove_worktree(str(repo), worktree)


def test_complete_merge_refuses_while_files_are_still_conflicted(isolated_registry, tmp_path):
    repo, worktree, entry = _make_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.complete_merge(entry["id"])

    assert result["ok"] is False
    assert "README.md" in result["message"]

    worktree_module.abort_merge_conflict(entry["id"])
    remove_worktree(str(repo), worktree)


def test_parse_conflict_markers_splits_context_and_conflict_blocks():
    text = (
        "line before\n"
        "<<<<<<< HEAD\n"
        "our line\n"
        "=======\n"
        "their line\n"
        ">>>>>>> feature-branch\n"
        "line after\n"
    )
    blocks = worktree_module.parse_conflict_markers(text)
    assert [b["type"] for b in blocks] == ["context", "conflict", "context"]
    assert blocks[1]["ours"] == "our line"
    assert blocks[1]["theirs"] == "their line"
    assert blocks[1]["ours_label"] == "HEAD"
    assert blocks[1]["theirs_label"] == "feature-branch"
    assert "base" not in blocks[1]


def test_parse_conflict_markers_handles_diff3_style_with_a_base_section():
    """merge.conflictstyle=diff3 inserts a ||||||| base section between
    ours and the ======= separator -- must not get folded into "ours"."""
    text = (
        "<<<<<<< HEAD\n"
        "our line\n"
        "||||||| merged common ancestors\n"
        "base line\n"
        "=======\n"
        "their line\n"
        ">>>>>>> feature-branch\n"
    )
    blocks = worktree_module.parse_conflict_markers(text)
    conflict = [b for b in blocks if b["type"] == "conflict"][0]
    assert conflict["ours"] == "our line"
    assert conflict["base"] == "base line"
    assert conflict["theirs"] == "their line"


def _make_binary_conflicting_merge(isolated_registry, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    (Path(worktree) / "asset.bin").write_bytes(b"\x00\x01SUBAGENT\x02\x00")
    subprocess.run(["git", "add", "."], cwd=worktree, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "sub agent edits binary"], cwd=worktree, check=True)
    (repo / "asset.bin").write_bytes(b"\x00\x01MAIN\x02\x00")
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "main moves on"], cwd=repo, check=True)
    entry = worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    return repo, worktree, entry


def test_get_merge_conflicts_reports_a_binary_file_distinctly(isolated_registry, tmp_path):
    repo, worktree, entry = _make_binary_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.get_merge_conflicts(entry["id"])

    assert result["ok"] is True
    assert result["files"]["asset.bin"] == {"binary": True}

    worktree_module.abort_merge_conflict(entry["id"])
    remove_worktree(str(repo), worktree)


def test_resolve_binary_conflict_keeps_theirs_and_completes(isolated_registry, tmp_path):
    repo, worktree, entry = _make_binary_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.resolve_binary_conflict(entry["id"], "asset.bin", "theirs")
    assert result["ok"] is True

    complete_result = worktree_module.complete_merge(entry["id"])
    assert complete_result["ok"] is True
    assert (repo / "asset.bin").read_bytes() == b"\x00\x01SUBAGENT\x02\x00"


def test_resolve_binary_conflict_rejects_an_invalid_choice(isolated_registry, tmp_path):
    repo, worktree, entry = _make_binary_conflicting_merge(isolated_registry, tmp_path)
    worktree_module.merge_worktree(entry["id"])

    result = worktree_module.resolve_binary_conflict(entry["id"], "asset.bin", "manual text")
    assert result["ok"] is False

    worktree_module.abort_merge_conflict(entry["id"])
    remove_worktree(str(repo), worktree)


def test_action_on_an_unknown_id_returns_not_found(isolated_registry):
    assert worktree_module.merge_worktree("nope")["ok"] is False
    assert worktree_module.discard_worktree("nope")["ok"] is False


def test_sweep_drops_entries_whose_directory_is_gone(isolated_registry, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    entry = worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    # Simulate a killed process: the worktree directory is gone but the
    # registry entry (and git's own worktree metadata) is stale.
    remove_worktree(str(repo), worktree)
    # Old enough to not be treated as a transient hiccup.
    entries = worktree_module._load_registry()
    entries[0]["created_at"] = 0
    worktree_module._save_registry(entries)

    pruned = worktree_module.sweep_orphaned_worktrees(max_age_seconds=1)
    assert pruned == 1
    assert worktree_module.list_pending_worktrees() == []


def test_sweep_keeps_entries_whose_directory_still_exists_regardless_of_age(isolated_registry, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    worktree = create_worktree(str(repo), "task-1")
    worktree_module.register_pending_worktree(
        worktree_path=worktree, project_dir=str(repo), branch="subagent/task-1", run_id="task-1",
    )
    entries = worktree_module._load_registry()
    entries[0]["created_at"] = 0  # ancient, but the directory is still real
    worktree_module._save_registry(entries)

    pruned = worktree_module.sweep_orphaned_worktrees(max_age_seconds=1)
    assert pruned == 0
    assert len(worktree_module.list_pending_worktrees()) == 1

    remove_worktree(str(repo), worktree)


def test_sweep_runs_fresh_every_call_not_just_once(isolated_registry, tmp_path, monkeypatch):
    """Unlike the watchdog's task seed, this must NOT be a one-shot-per-process
    guard: the recurring worktree_sweep scheduled task (agent/tools/scheduler/
    integration.py's _execute_worktree_sweep) calls this on every tick and
    needs each call to actually re-check the registry, or an orphan left by a
    process killed mid-lifetime would never get swept."""
    calls = []
    monkeypatch.setattr(worktree_module, "_load_registry", lambda: (calls.append(1) or []))

    worktree_module.sweep_orphaned_worktrees()
    worktree_module.sweep_orphaned_worktrees()

    assert len(calls) == 2
