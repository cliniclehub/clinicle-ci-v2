# encoding:utf-8
"""agent/protocol/agent_stream.py's approval gate: the highest-risk change
in this session, since it edits _execute_tool -- the one chokepoint every
agent's every tool call runs through. These tests exist specifically to pin
down that an agent WITHOUT the opt-in flag (every existing agent, today)
gets byte-identical behavior, and that staging only ever intercepts the two
gated tools for the one Agent that opted in.
"""

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from agent.protocol.agent_stream import AgentStreamExecutor
from agent.tools.edit.edit import Edit
from agent.tools.write.write import Write


class _Bash:
    """Stand-in for a non-file tool, to prove the gate never touches
    anything outside edit/write."""
    name = "bash"
    params = {"required": []}

    def __init__(self):
        self.ran_with = None

    def execute_tool(self, arguments):
        from agent.tools.base_tool import ToolResult
        self.ran_with = arguments
        return ToolResult.success({"message": "ran"})


def _executor(tools, agent_id="doctor"):
    agent = SimpleNamespace(
        name="test-agent", messages=[], tools=list(tools.values()), workspace_dir=None,
        _current_agent_id=agent_id, _current_session_id="s1",
    )
    return AgentStreamExecutor(
        agent=agent, model=SimpleNamespace(model="test-model"), system_prompt="",
        tools=list(tools.values()), max_turns=3,
    )


@pytest.fixture(autouse=True)
def isolated_pending_store(tmp_path, monkeypatch):
    from agent.workspace import pending_edits_store
    monkeypatch.setattr(pending_edits_store, "_db_path", lambda org_id: tmp_path / "pending_edits.db")
    yield


def _fake_file(work, name="f.py", content="x = 1\n"):
    path = os.path.join(work, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def test_flag_off_edit_executes_normally_unchanged():
    """The regression pin: every existing agent (flag unset) must see
    edit/write behave exactly as before this feature existed."""
    with tempfile.TemporaryDirectory() as work:
        path = _fake_file(work)
        edit = Edit({"cwd": work})
        executor = _executor({"edit": edit})

        with patch("agent.permission.execution_gate.requires_approval", return_value=False):
            result = executor._execute_tool({
                "id": "tc1", "name": "edit",
                "arguments": {"path": path, "oldText": "x = 1", "newText": "x = 2"},
            })

        assert result["status"] == "success"
        with open(path, encoding="utf-8") as f:
            assert f.read() == "x = 2\n"


def test_flag_on_edit_is_staged_and_never_executes():
    with tempfile.TemporaryDirectory() as work:
        path = _fake_file(work)
        edit = Edit({"cwd": work})
        executor = _executor({"edit": edit})

        with patch("agent.permission.execution_gate.requires_approval", return_value=True):
            result = executor._execute_tool({
                "id": "tc1", "name": "edit",
                "arguments": {"path": path, "oldText": "x = 1", "newText": "x = 2"},
            })

        assert result["status"] == "error"  # same shape as a permission denial
        assert "staged for human approval" in result["result"]
        # The whole point: the file is untouched.
        with open(path, encoding="utf-8") as f:
            assert f.read() == "x = 1\n"


def test_flag_on_edit_creates_a_pending_edit_with_the_diff():
    from agent.workspace.pending_edits_store import list_pending_edits

    with tempfile.TemporaryDirectory() as work:
        path = _fake_file(work)
        edit = Edit({"cwd": work})
        executor = _executor({"edit": edit})

        with patch("agent.permission.execution_gate.requires_approval", return_value=True):
            executor._execute_tool({
                "id": "tc1", "name": "edit",
                "arguments": {"path": path, "oldText": "x = 1", "newText": "x = 2"},
            })

        pending = list_pending_edits(None)
        assert len(pending) == 1
        assert pending[0]["tool_name"] == "edit"
        assert pending[0]["status"] == "pending"
        assert "x = 2" in pending[0]["diff"]
        assert pending[0]["arguments"]["oldText"] == "x = 1"
        # The tool's own cwd at staging time, so a relative path would still
        # resolve correctly at approval time in a later, separate request.
        assert pending[0]["cwd"] == work


def test_flag_on_write_is_staged_and_never_executes():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "new.txt")
        write = Write({"cwd": work})
        executor = _executor({"write": write})

        with patch("agent.permission.execution_gate.requires_approval", return_value=True):
            result = executor._execute_tool({
                "id": "tc1", "name": "write", "arguments": {"path": path, "content": "hello\n"},
            })

        assert result["status"] == "error"
        assert "staged for human approval" in result["result"]
        assert not os.path.exists(path)


def test_flag_on_does_not_gate_a_non_file_tool():
    bash = _Bash()
    executor = _executor({"bash": bash})

    with patch("agent.permission.execution_gate.requires_approval", return_value=True):
        result = executor._execute_tool({"id": "tc1", "name": "bash", "arguments": {"command": "ls"}})

    assert result["status"] == "success"
    assert bash.ran_with == {"command": "ls"}


def test_a_call_that_would_fail_anyway_fails_normally_instead_of_staging():
    """A call that could never apply (bad oldText) should surface its real
    error, not a confusing 'staged' message for something that can't land."""
    with tempfile.TemporaryDirectory() as work:
        path = _fake_file(work)
        edit = Edit({"cwd": work})
        executor = _executor({"edit": edit})

        with patch("agent.permission.execution_gate.requires_approval", return_value=True):
            result = executor._execute_tool({
                "id": "tc1", "name": "edit",
                "arguments": {"path": path, "oldText": "does not exist", "newText": "y"},
            })

        assert result["status"] == "error"
        assert "Could not find the exact text" in result["result"]
        from agent.workspace.pending_edits_store import list_pending_edits
        assert list_pending_edits(None) == []  # nothing staged for an unapplicable call


def test_gate_failure_falls_through_to_normal_execution():
    """If the gate itself malfunctions, the call must still run -- a broken
    approval feature must never become a way to silently block every edit."""
    with tempfile.TemporaryDirectory() as work:
        path = _fake_file(work)
        edit = Edit({"cwd": work})
        executor = _executor({"edit": edit})

        with patch("agent.permission.execution_gate.requires_approval", side_effect=RuntimeError("boom")):
            result = executor._execute_tool({
                "id": "tc1", "name": "edit",
                "arguments": {"path": path, "oldText": "x = 1", "newText": "x = 2"},
            })

        assert result["status"] == "success"
        with open(path, encoding="utf-8") as f:
            assert f.read() == "x = 2\n"
