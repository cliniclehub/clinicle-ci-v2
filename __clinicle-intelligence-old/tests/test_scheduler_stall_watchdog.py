# encoding:utf-8
"""agent/tools/scheduler/integration.py: the stall-watchdog action type.
Same fake-bridge convention as test_scheduled_task_empty_reply.py; a real
ConversationStore in tmp_path exercises the actual claim/list_stuck_runs
logic rather than mocking it away."""

import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from agent.memory.conversation_store import ConversationStore
from agent.tools.scheduler.integration import (
    _WATCHDOG_TASK_ID,
    _execute_stall_watchdog,
    seed_stall_watchdog_task,
)
from agent.tools.scheduler.task_store import TaskStore


class _AgentBridge:
    def __init__(self):
        self.calls = []

    def agent_reply(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        from types import SimpleNamespace
        return SimpleNamespace(content="continuing now")


def _watchdog_task(threshold=900, max_nudges=2):
    return {
        "id": _WATCHDOG_TASK_ID,
        "action": {
            "type": "stall_watchdog",
            "stall_threshold_seconds": threshold,
            "max_nudges_per_session": max_nudges,
        },
    }


def _backdate(store, run_id, seconds_ago):
    # Reuses the store's own connection helper (same WAL pragmas) rather than
    # a bare sqlite3.connect against the same file.
    conn = store._raw_connect()
    try:
        conn.execute(
            "UPDATE runs SET started_at = ? WHERE run_id = ?",
            (int(time.time()) - seconds_ago, run_id),
        )
        conn.commit()
    finally:
        conn.close()


def test_no_stuck_runs_is_a_clean_noop():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _AgentBridge()
            sink = {}
            result = _execute_stall_watchdog(_watchdog_task(), bridge, output_sink=sink)

        assert result is True
        assert bridge.calls == []
        assert "0 stuck run(s)" in sink["preview"]


def test_a_stuck_run_gets_nudged_in_its_own_session():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", agent_id="doctor", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)

        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _AgentBridge()
            result = _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert result is True
        assert len(bridge.calls) == 1
        prompt, kwargs = bridge.calls[0]
        assert kwargs["context"]["session_id"] == "s1"
        assert kwargs["context"]["agent_id"] == "doctor"
        # The stuck run itself must no longer read "running" once claimed.
        assert store.get_run("r1")["status"] == "stale"


def test_a_run_still_within_the_threshold_is_left_alone():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 100)  # well under the 900s threshold

        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert bridge.calls == []
        assert store.get_run("r1")["status"] == "running"


class _FakeProfile:
    def __init__(self, watchdog_stall_threshold_seconds=None, watchdog_max_nudges=None, watchdog_nudge_prompt=None):
        self.watchdog_stall_threshold_seconds = watchdog_stall_threshold_seconds
        self.watchdog_max_nudges = watchdog_max_nudges
        self.watchdog_nudge_prompt = watchdog_nudge_prompt


class _FakeRegistry:
    """Just enough of AgentRegistry's surface for _execute_stall_watchdog's
    per-agent override lookup -- .list() (used to widen the scan cutoff) and
    .get() (used per-run)."""

    def __init__(self, profiles):
        self._profiles = profiles

    def list(self, include_disabled=True):
        return list(self._profiles.values())

    def get(self, agent_id, require_enabled=False):
        return self._profiles.get(agent_id, _FakeProfile())


def test_a_per_agent_stricter_override_catches_a_stall_the_global_default_would_miss():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", agent_id="fast-agent", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 200)  # well under the global 900s default

        registry = _FakeRegistry({"fast-agent": _FakeProfile(watchdog_stall_threshold_seconds=100)})
        with patch("agent.memory.get_conversation_store", return_value=store), \
             patch("agent.registry.get_agent_registry", return_value=registry):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert len(bridge.calls) == 1
        assert store.get_run("r1")["status"] == "stale"


def test_a_per_agent_custom_nudge_prompt_is_used_when_set():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", agent_id="custom-prompt-agent", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)

        registry = _FakeRegistry({
            "custom-prompt-agent": _FakeProfile(watchdog_nudge_prompt="Hey, still there? {minutes}m so far."),
        })
        with patch("agent.memory.get_conversation_store", return_value=store), \
             patch("agent.registry.get_agent_registry", return_value=registry):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert len(bridge.calls) == 1
        prompt = bridge.calls[0][0]
        assert prompt == "Hey, still there? 15m so far."


def test_a_custom_nudge_prompt_with_no_placeholder_is_sent_verbatim():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", agent_id="plain-prompt-agent", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)

        registry = _FakeRegistry({
            "plain-prompt-agent": _FakeProfile(watchdog_nudge_prompt="Please continue."),
        })
        with patch("agent.memory.get_conversation_store", return_value=store), \
             patch("agent.registry.get_agent_registry", return_value=registry):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert bridge.calls[0][0] == "Please continue."


def test_a_malformed_custom_prompt_falls_back_to_being_sent_as_is():
    """A stray {brace} the admin didn't mean as a format field must not break
    the nudge -- send it verbatim rather than raise and skip the run."""
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", agent_id="broken-prompt-agent", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)

        registry = _FakeRegistry({
            "broken-prompt-agent": _FakeProfile(watchdog_nudge_prompt="Status update {please}?"),
        })
        with patch("agent.memory.get_conversation_store", return_value=store), \
             patch("agent.registry.get_agent_registry", return_value=registry):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert bridge.calls[0][0] == "Status update {please}?"


def test_no_custom_prompt_falls_back_to_the_built_in_default():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)

        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=900), bridge)

        assert "stalled" in bridge.calls[0][0]


def test_a_per_agent_looser_override_is_not_nudged_early_despite_the_global_default():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", agent_id="patient-agent", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "r1", 200)  # past the global 100s default, not the agent's own 900s

        registry = _FakeRegistry({"patient-agent": _FakeProfile(watchdog_stall_threshold_seconds=900)})
        with patch("agent.memory.get_conversation_store", return_value=store), \
             patch("agent.registry.get_agent_registry", return_value=registry):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(threshold=100), bridge)

        assert bridge.calls == []
        assert store.get_run("r1")["status"] == "running"


def test_a_run_with_no_session_id_is_claimed_but_not_nudged():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", session_id="", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)

        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(), bridge)

        assert bridge.calls == []
        assert store.get_run("r1")["status"] == "stale"


def test_nudge_cap_stops_repeated_nudging_of_the_same_session():
    """A session already nudged max_nudges times is marked stale without a
    further nudge -- prevents an infinite nudge chain on one stuck session."""
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        # Two prior nudge-runs already recorded against this session.
        store.create_run("nudge-1", session_id="s1", task_source="watchdog_nudge", task_id="")
        store.create_run("nudge-2", session_id="s1", task_source="watchdog_nudge", task_id="")
        store.create_run("stuck", session_id="s1", task_source="x", task_id="t")
        _backdate(store, "stuck", 1000)

        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _AgentBridge()
            _execute_stall_watchdog(_watchdog_task(max_nudges=2), bridge)

        assert bridge.calls == []  # at cap, no further nudge
        assert store.get_run("stuck")["status"] == "stale"


def test_a_failed_individual_nudge_does_not_abort_the_whole_scan():
    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.create_run("r1", session_id="s1", task_source="x", task_id="t")
        store.create_run("r2", session_id="s2", task_source="x", task_id="t")
        _backdate(store, "r1", 1000)
        _backdate(store, "r2", 1000)

        class _ExplodingBridge:
            def __init__(self):
                self.calls = 0

            def agent_reply(self, prompt, **kwargs):
                self.calls += 1
                raise RuntimeError("agent unavailable")

        with patch("agent.memory.get_conversation_store", return_value=store):
            bridge = _ExplodingBridge()
            result = _execute_stall_watchdog(_watchdog_task(), bridge)

        assert result is True  # the scan itself still completed
        assert bridge.calls == 2  # both stuck runs were attempted
        # Both were claimed (removed from 'running') even though the nudge
        # failed -- a nudge failure must not leave a run stuck forever.
        assert store.get_run("r1")["status"] == "stale"
        assert store.get_run("r2")["status"] == "stale"


def test_scan_failure_returns_false_so_the_tick_retries():
    with patch("agent.memory.get_conversation_store", side_effect=RuntimeError("db unavailable")):
        bridge = _AgentBridge()
        result = _execute_stall_watchdog(_watchdog_task(), bridge)
    assert result is False


# --- seeding -----------------------------------------------------------------


def test_seed_creates_an_enabled_task_once():
    with tempfile.TemporaryDirectory() as tmp:
        store = TaskStore(str(Path(tmp) / "tasks.json"))
        with patch("agent.tools.scheduler.integration.get_task_store", return_value=store):
            seed_stall_watchdog_task()

        task = store.get_task(_WATCHDOG_TASK_ID)
        assert task is not None
        assert task["enabled"] is True
        assert task["action"]["type"] == "stall_watchdog"


def test_seed_is_idempotent_and_never_overwrites_an_admins_edit():
    with tempfile.TemporaryDirectory() as tmp:
        store = TaskStore(str(Path(tmp) / "tasks.json"))
        with patch("agent.tools.scheduler.integration.get_task_store", return_value=store):
            seed_stall_watchdog_task()
            store.enable_task(_WATCHDOG_TASK_ID, True)  # the admin turned it on
            seed_stall_watchdog_task()  # a later restart must not undo that

        assert store.get_task(_WATCHDOG_TASK_ID)["enabled"] is True
