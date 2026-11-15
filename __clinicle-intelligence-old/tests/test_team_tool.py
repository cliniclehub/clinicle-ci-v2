# encoding:utf-8
"""Guard the Agent-facing side of Teams: an Agent must only be able to see
and change a team it actually belongs to, regardless of what team_id it is
handed. Complements test_team_store.py (the pure store) and test_teams_api.py
(the web API) -- this is the third caller of team_store, and the only one
that runs inside a live conversation.
"""

from unittest.mock import MagicMock, patch

import pytest

from agent.tools.team.team_tool import TeamManageTool
from agent.workspace import team_store
from bridge.reply import Reply, ReplyType


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(team_store, "_store_file", lambda: str(tmp_path / "teams.json"))


@pytest.fixture(autouse=True)
def synchronous_dispatch(monkeypatch):
    """delegate now runs the teammate's turn (and the leader wake-up that
    follows it) on a background thread. Tests join that thread before
    start() returns so assertions stay deterministic -- but it must stay a
    REAL separate thread (not inlined on the caller's thread), since the
    whole point of the chain_snapshot mechanism is that _delegation_chain
    (a threading.local()) does NOT leak back onto the calling thread."""
    import agent.tools.team.team_tool as team_tool_module

    real_thread_class = team_tool_module.threading.Thread  # capture BEFORE patching --
    # threading is a shared module object, so patching its .Thread attribute
    # would otherwise make any later `threading.Thread` reference (including
    # one taken after this point) resolve to the patched class too.

    class _JoinedThread:
        def __init__(self, target=None, daemon=None):
            self._real = real_thread_class(target=target)

        def start(self):
            self._real.start()
            self._real.join()

    monkeypatch.setattr(team_tool_module.threading, "Thread", _JoinedThread)


@pytest.fixture
def tool():
    return TeamManageTool()


def test_list_shows_only_teams_the_agent_belongs_to(tool):
    team_store.create_team("mine", [{"agent_id": "boss", "role": "leader"}])
    team_store.create_team("not mine", [{"agent_id": "someone-else", "role": "leader"}])
    result = tool.execute({"action": "list", "agent_id": "boss"})
    assert result.status == "success"
    names = [t["name"] for t in result.result["teams"]]
    assert names == ["mine"]


def test_get_refuses_a_team_the_agent_is_not_on(tool):
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    result = tool.execute({"action": "get", "agent_id": "outsider", "team_id": team["id"]})
    assert result.status == "error"
    assert "not a member" in result.result.lower()


def test_get_works_for_an_actual_member(tool):
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    result = tool.execute({"action": "get", "agent_id": "writer", "team_id": team["id"]})
    assert result.status == "success"
    assert len(result.result["members"]) == 2


def test_add_member_refuses_a_nonmember_caller(tool):
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    result = tool.execute({
        "action": "add_member", "agent_id": "outsider",
        "team_id": team["id"], "member_agent_id": "writer",
    })
    assert result.status == "error"
    fresh = team_store.get_team(team["id"])
    assert len(fresh["members"]) == 1  # nothing added


def test_leader_can_add_a_member(tool):
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    result = tool.execute({
        "action": "add_member", "agent_id": "boss",
        "team_id": team["id"], "member_agent_id": "writer",
    })
    assert result.status == "success"
    assert result.result["member_count"] == 2


def test_removing_the_leader_fails_cleanly_not_with_a_traceback(tool):
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    leader_slot = team["members"][0]["slot_id"]
    result = tool.execute({
        "action": "remove_member", "agent_id": "boss",
        "team_id": team["id"], "slot_id": leader_slot,
    })
    assert result.status == "error"


def test_unknown_team_id_fails_cleanly(tool):
    result = tool.execute({"action": "get", "agent_id": "boss", "team_id": "does-not-exist"})
    assert result.status == "error"


def test_missing_agent_id_is_rejected(tool):
    result = tool.execute({"action": "list"})
    assert result.status == "error"


# =====================================================================
# delegate: the actual swarm mechanism -- run a teammate's own session,
# not a synthetic delegation session, so their Teams-grid column shows it.
# =====================================================================

def test_delegate_targets_the_teammates_own_session(tool):
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    boss_slot, writer_slot = team["members"][0], team["members"][1]

    # bridge.context.Context shares underlying storage across instances on
    # one thread (confirmed: constructing a 2nd Context() and setting a key
    # changes what an earlier Context() reads back for that same key) -- so
    # a MagicMock's call_args_list, inspected AFTER both calls complete,
    # would see the LATER (wake) call's values for BOTH recorded calls. Real
    # agent_reply() isn't affected (each call is consumed synchronously,
    # fully, before the next Context() is built) but the test must snapshot
    # each call's relevant fields eagerly, at call time, not after the fact.
    seen_calls = []

    def _snapshot_and_reply(task_text, context, **kw):
        seen_calls.append({"task": task_text, "session_id": context["session_id"], "agent_id": context["agent_id"]})
        return Reply(ReplyType.TEXT, "draft is ready")

    fake_bridge = MagicMock()
    fake_bridge.agent_reply.side_effect = _snapshot_and_reply

    with patch("bridge.bridge.Bridge") as MockBridge:
        MockBridge.return_value.get_agent_bridge.return_value = fake_bridge
        result = tool.execute({
            "action": "delegate", "agent_id": "boss", "team_id": team["id"],
            "target_slot_id": writer_slot["slot_id"], "task": "write the intro",
        })

    # delegate is now dispatch-and-notify, not blocking -- it returns
    # immediately, the result comes back later as a wake-up turn.
    assert result.status == "success"
    assert result.result["dispatched"] is True
    assert result.result["target_agent_id"] == "writer"

    # Two calls: the teammate's own turn, pointed at their OWN session_id
    # (not some synthetic derived one -- that's the entire point), then the
    # leader wake-up turn carrying the result back to the Leader's session.
    assert len(seen_calls) == 2
    assert seen_calls[0]["session_id"] == writer_slot["session_id"]
    assert seen_calls[0]["agent_id"] == "writer"
    assert seen_calls[1]["session_id"] == boss_slot["session_id"]
    assert seen_calls[1]["agent_id"] == "boss"
    assert "draft is ready" in seen_calls[1]["task"]


def test_delegate_resolves_target_by_agent_id_when_no_slot_given(tool):
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    fake_bridge = MagicMock()
    fake_bridge.agent_reply.return_value = Reply(ReplyType.TEXT, "done")

    with patch("bridge.bridge.Bridge") as MockBridge:
        MockBridge.return_value.get_agent_bridge.return_value = fake_bridge
        result = tool.execute({
            "action": "delegate", "agent_id": "boss", "team_id": team["id"],
            "target_agent_id": "writer", "task": "go",
        })
    assert result.status == "success"


def test_delegate_refuses_to_target_self(tool):
    team = team_store.create_team("t", [{"agent_id": "boss", "role": "leader"}])
    result = tool.execute({
        "action": "delegate", "agent_id": "boss", "team_id": team["id"],
        "target_agent_id": "boss", "task": "go",
    })
    assert result.status == "error"


def test_delegate_requires_a_task():
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    tool = TeamManageTool()
    result = tool.execute({
        "action": "delegate", "agent_id": "boss", "team_id": team["id"],
        "target_agent_id": "writer",
    })
    assert result.status == "error"


def test_delegate_refuses_a_nonmember_caller(tool):
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    result = tool.execute({
        "action": "delegate", "agent_id": "outsider", "team_id": team["id"],
        "target_agent_id": "writer", "task": "go",
    })
    assert result.status == "error"


def test_delegate_detects_a_direct_cycle(tool):
    """boss delegating to writer while already inside a boss->writer hop
    (the thread-local chain already carries 'boss') must not recurse."""
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    from agent.tools.team.team_tool import _delegation_chain
    _delegation_chain.agent_ids = ["boss"]
    try:
        fake_bridge = MagicMock()
        with patch("bridge.bridge.Bridge") as MockBridge:
            MockBridge.return_value.get_agent_bridge.return_value = fake_bridge
            result = tool.execute({
                "action": "delegate", "agent_id": "writer", "team_id": team["id"],
                "target_agent_id": "boss", "task": "go",
            })
        assert result.status == "error"
        fake_bridge.agent_reply.assert_not_called()
    finally:
        _delegation_chain.agent_ids = []


def test_delegate_marks_slot_running_during_the_call_then_clears(tool):
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    writer_slot = team["members"][1]
    seen_mid_call = {}

    def _fake_reply(*args, **kwargs):
        seen_mid_call.update(team_store.get_slot_work(team["id"]))
        return Reply(ReplyType.TEXT, "ok")

    fake_bridge = MagicMock()
    fake_bridge.agent_reply.side_effect = _fake_reply
    with patch("bridge.bridge.Bridge") as MockBridge:
        MockBridge.return_value.get_agent_bridge.return_value = fake_bridge
        tool.execute({
            "action": "delegate", "agent_id": "boss", "team_id": team["id"],
            "target_slot_id": writer_slot["slot_id"], "task": "go",
        })

    assert writer_slot["slot_id"] in seen_mid_call
    assert team_store.get_slot_work(team["id"]) == {}


def test_delegate_chain_is_cleared_after_success(tool):
    """The chain must not leak between calls -- a second, unrelated delegate
    call right after must not see stale entries from the first."""
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    fake_bridge = MagicMock()
    fake_bridge.agent_reply.return_value = Reply(ReplyType.TEXT, "ok")
    with patch("bridge.bridge.Bridge") as MockBridge:
        MockBridge.return_value.get_agent_bridge.return_value = fake_bridge
        tool.execute({
            "action": "delegate", "agent_id": "boss", "team_id": team["id"],
            "target_agent_id": "writer", "task": "go",
        })
    from agent.tools.team.team_tool import _delegation_chain
    assert getattr(_delegation_chain, "agent_ids", []) == []


def test_delegate_surfaces_a_failure_from_the_target_run_not_a_traceback(tool):
    """delegate dispatches and returns immediately (async), so a failure in
    the teammate's own turn can't come back as this call's result -- it must
    still reach the Leader, as the wake-up message's content, not silently
    vanish or crash the background thread."""
    team = team_store.create_team("t", [
        {"agent_id": "boss", "role": "leader"},
        {"agent_id": "writer", "role": "teammate"},
    ])
    fake_bridge = MagicMock()
    fake_bridge.agent_reply.side_effect = [RuntimeError("target agent crashed"), Reply(ReplyType.TEXT, "ok")]
    with patch("bridge.bridge.Bridge") as MockBridge:
        MockBridge.return_value.get_agent_bridge.return_value = fake_bridge
        result = tool.execute({
            "action": "delegate", "agent_id": "boss", "team_id": team["id"],
            "target_agent_id": "writer", "task": "go",
        })
    assert result.status == "success"  # dispatch itself always succeeds
    assert result.result["dispatched"] is True

    wake_call = fake_bridge.agent_reply.call_args_list[1]
    assert "target agent crashed" in wake_call.args[0]
    assert wake_call.kwargs["context"]["agent_id"] == "boss"
