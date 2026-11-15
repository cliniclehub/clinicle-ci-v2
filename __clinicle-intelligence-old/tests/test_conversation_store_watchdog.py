# encoding:utf-8
"""agent/memory/conversation_store.py: list_stuck_runs and claim_stale_run --
the stall-watchdog's read/claim primitives. Same isolation contract as the
rest of the runs table (auxiliary, never able to take conversation storage
down); see test_conversation_runs.py for that table's other coverage."""

import sqlite3
import tempfile
import time
from pathlib import Path

from agent.memory.conversation_store import ConversationStore


def _store(tmpdir):
    return ConversationStore(Path(tmpdir) / "index.db")


def _backdate(tmpdir, run_id, seconds_ago):
    conn = sqlite3.connect(str(Path(tmpdir) / "index.db"))
    try:
        conn.execute(
            "UPDATE runs SET started_at = ? WHERE run_id = ?",
            (int(time.time()) - seconds_ago, run_id),
        )
        conn.commit()
    finally:
        conn.close()


def test_list_stuck_runs_only_returns_old_running_rows():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("fresh", task_source="scheduler", task_id="t")
        store.create_run("stale", task_source="scheduler", task_id="t")
        _backdate(tmp, "stale", 1000)

        stuck = store.list_stuck_runs(older_than_seconds=900)
        assert [r["run_id"] for r in stuck] == ["stale"]


def test_list_stuck_runs_excludes_finished_runs_even_if_old():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("done-long-ago", task_source="scheduler", task_id="t")
        _backdate(tmp, "done-long-ago", 1000)
        store.finish_run("done-long-ago", status="done")

        assert store.list_stuck_runs(older_than_seconds=900) == []


def test_list_stuck_runs_scopes_by_agent_id():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("a-stuck", agent_id="sales", task_source="x", task_id="t")
        store.create_run("b-stuck", agent_id="pm", task_source="x", task_id="t")
        _backdate(tmp, "a-stuck", 1000)
        _backdate(tmp, "b-stuck", 1000)

        assert [r["run_id"] for r in store.list_stuck_runs(900, agent_id="sales")] == ["a-stuck"]


def test_list_stuck_runs_orders_oldest_first():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("older", task_source="x", task_id="t")
        store.create_run("newer", task_source="x", task_id="t")
        _backdate(tmp, "older", 2000)
        _backdate(tmp, "newer", 1000)

        assert [r["run_id"] for r in store.list_stuck_runs(900)] == ["older", "newer"]


def test_claim_stale_run_transitions_status_and_sets_ended_at():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("r1", task_source="x", task_id="t")

        assert store.claim_stale_run("r1") is True
        run = store.get_run("r1")
        assert run["status"] == "stale"
        assert run["ended_at"] is not None


def test_claim_stale_run_is_the_atomic_claim_second_caller_loses():
    """Two callers racing to claim the same run: only the first succeeds."""
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("r1", task_source="x", task_id="t")

        assert store.claim_stale_run("r1") is True
        assert store.claim_stale_run("r1") is False  # already claimed


def test_claim_stale_run_refuses_a_run_that_already_finished():
    """A run that completed naturally between the scan and the claim must
    not be reopened/reclaimed as stale -- that would overwrite a real outcome."""
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.create_run("r1", task_source="x", task_id="t")
        store.finish_run("r1", status="done")

        assert store.claim_stale_run("r1") is False
        assert store.get_run("r1")["status"] == "done"


def test_claim_stale_run_on_unknown_id_is_false():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        assert store.claim_stale_run("does-not-exist") is False


def test_list_stuck_runs_and_claim_degrade_to_noop_when_runs_unavailable():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store._runs_ready = False
        assert store.list_stuck_runs(900) == []
        assert store.claim_stale_run("anything") is False
