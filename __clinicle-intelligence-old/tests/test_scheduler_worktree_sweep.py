# encoding:utf-8
"""agent/tools/scheduler/integration.py's worktree_sweep action type: the
recurring counterpart of the immediate at-boot sweep, catching an orphan
left by a process killed during THIS process's own lifetime (which the
boot-time call can never see -- it only ever runs once)."""

import tempfile
from pathlib import Path
from unittest.mock import patch

from agent.subagent import worktree as worktree_module
from agent.tools.scheduler.integration import (
    _WORKTREE_SWEEP_TASK_ID,
    _execute_worktree_sweep,
    seed_worktree_sweep_task,
)
from agent.tools.scheduler.task_store import TaskStore


def test_execute_reports_the_pruned_count(tmp_path, monkeypatch):
    monkeypatch.setattr(worktree_module, "_REGISTRY_PATH", tmp_path / "pending_worktrees.json")
    monkeypatch.setattr(worktree_module, "_load_registry", lambda: [
        {"id": "wt_1", "worktree_path": str(tmp_path / "gone"), "project_dir": "", "created_at": 0}
    ])
    monkeypatch.setattr(worktree_module, "_save_registry", lambda entries: None)

    sink = {}
    result = _execute_worktree_sweep(output_sink=sink)

    assert result is True
    assert "1 orphaned worktree" in sink["preview"]


def test_execute_returns_false_and_never_raises_on_failure(monkeypatch):
    def _boom():
        raise RuntimeError("registry unreadable")

    monkeypatch.setattr(worktree_module, "sweep_orphaned_worktrees", _boom)
    assert _execute_worktree_sweep() is False


def test_seed_creates_an_enabled_recurring_task_once():
    with tempfile.TemporaryDirectory() as tmp:
        store = TaskStore(str(Path(tmp) / "tasks.json"))
        with patch("agent.tools.scheduler.integration.get_task_store", return_value=store):
            seed_worktree_sweep_task()
            seed_worktree_sweep_task()  # idempotent

        task = store.get_task(_WORKTREE_SWEEP_TASK_ID)
        assert task is not None
        assert task["enabled"] is True
        assert task["action"]["type"] == "worktree_sweep"
        assert task["schedule"] == {"type": "interval", "seconds": 1800}


def test_seed_never_overwrites_an_admins_own_disable():
    with tempfile.TemporaryDirectory() as tmp:
        store = TaskStore(str(Path(tmp) / "tasks.json"))
        with patch("agent.tools.scheduler.integration.get_task_store", return_value=store):
            seed_worktree_sweep_task()
            store.enable_task(_WORKTREE_SWEEP_TASK_ID, False)
            seed_worktree_sweep_task()

        assert store.get_task(_WORKTREE_SWEEP_TASK_ID)["enabled"] is False


def test_worktree_sweep_is_excluded_from_every_per_agent_task_list():
    """Same reasoning as stall_watchdog: a cross-agent system task has no
    single owner, so it must never pollute the default Agent's own list."""
    with tempfile.TemporaryDirectory() as tmp:
        store = TaskStore(str(Path(tmp) / "tasks.json"))
        with patch("agent.tools.scheduler.integration.get_task_store", return_value=store):
            seed_worktree_sweep_task()
        store.add_task({"id": "daily", "agent_id": "primary", "action": {"type": "reminder"}})

        assert _WORKTREE_SWEEP_TASK_ID not in [t["id"] for t in store.list_tasks(agent_id="primary")]
