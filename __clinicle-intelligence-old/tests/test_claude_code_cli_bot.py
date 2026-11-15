# encoding:utf-8
"""models/claude_code_cli_bot.py: shells to the Claude Code CLI's headless
mode. No real CLI invoked -- subprocess.run is monkeypatched, since these
tests are about the bot's own contract (return shape, error handling,
disclosed-gap marker), not about the actual CLI binary."""

from unittest.mock import MagicMock, patch

import pytest

from agent.registry import AgentProfile, AgentRegistry, set_agent_registry
from common.runtime_identity import identity_scope
from models.claude_code_cli_bot import ClaudeCodeCliBot


@pytest.fixture
def registry_with_governed_agent(tmp_path):
    registry = AgentRegistry(
        [
            AgentProfile("governed", "Governed", str(tmp_path / "governed"), require_approval_for_writes=True),
            AgentProfile("open", "Open", str(tmp_path / "open"), require_approval_for_writes=False),
        ],
        default_agent_id="open",
    )
    set_agent_registry(registry)
    try:
        yield registry
    finally:
        set_agent_registry(None)


def _fake_proc(returncode=0, stdout="", stderr=""):
    proc = MagicMock()
    proc.returncode = returncode
    proc.stdout = stdout
    proc.stderr = stderr
    return proc


def test_declares_the_disclosed_tool_loop_gap():
    """Read back at agent_stream.py's audit choke point -- must be False,
    and must be discoverable as a plain class/instance attribute."""
    assert ClaudeCodeCliBot.HOST_VISIBLE_TOOL_LOOP is False
    assert ClaudeCodeCliBot().HOST_VISIBLE_TOOL_LOOP is False


def test_call_with_tools_returns_a_chat_completion_shape_on_success():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(
        stdout='{"result": "Done. Fixed the bug.", "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}',
    )):
        response = bot.call_with_tools([{"role": "user", "content": "fix the bug"}])

    assert response["choices"][0]["message"]["content"] == "Done. Fixed the bug."
    assert response["choices"][0]["finish_reason"] == "stop"
    assert response["usage"]["total_tokens"] == 15


def test_ignores_the_tools_parameter_entirely():
    """The CLI runs its own internal tool loop -- this bot must never try to
    translate `tools` into anything the CLI understands."""
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(stdout='{"result": "ok"}')) as run:
        bot.call_with_tools([{"role": "user", "content": "go"}], tools=[{"name": "bash"}])
    called_args = run.call_args[0][0]
    assert "bash" not in " ".join(called_args)


def test_non_json_stdout_falls_back_to_raw_text():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(stdout="plain text reply, not json")):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["choices"][0]["message"]["content"] == "plain text reply, not json"


def test_missing_cli_binary_returns_an_error_dict_not_an_exception():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", side_effect=FileNotFoundError()):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["error"] is True
    assert "not found" in response["message"]


def test_timeout_returns_an_error_dict_not_an_exception():
    import subprocess as sp

    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", side_effect=sp.TimeoutExpired(cmd="claude", timeout=300)):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["error"] is True
    assert "timed out" in response["message"]


def test_nonzero_exit_code_returns_an_error_dict():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(returncode=1, stderr="auth failed")):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["error"] is True
    assert "auth failed" in response["message"]


def test_stream_true_yields_content_then_a_final_usage_chunk():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(
        stdout='{"result": "hi", "usage": {"total_tokens": 3}}',
    )):
        chunks = list(bot.call_with_tools([{"role": "user", "content": "go"}], stream=True))

    assert chunks[0]["choices"][0]["delta"]["content"] == "hi"
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"
    assert chunks[-1]["usage"]["total_tokens"] == 3


def test_stream_true_error_yields_one_error_chunk():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", side_effect=FileNotFoundError()):
        chunks = list(bot.call_with_tools([{"role": "user", "content": "go"}], stream=True))
    assert chunks == [{"error": True, "message": "'claude' CLI not found on PATH", "status_code": 500}]


def test_flattens_message_history_and_system_prompt_into_one_prompt():
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(stdout='{"result": "ok"}')) as run:
        bot.call_with_tools(
            [{"role": "user", "content": "first"}, {"role": "assistant", "content": "second"}],
            system="be terse",
        )
    prompt = run.call_args[0][0][2]  # ["claude", "-p", <prompt>, ...]
    assert "be terse" in prompt
    assert "first" in prompt
    assert "second" in prompt


# =====================================================================
# Partial real governance: require_approval_for_writes -> --disallowedTools
# (headless mode has no TTY to stage a diff for a human the way the host's
# own approval gate does, so this is the fail-closed equivalent instead).
# =====================================================================

def test_no_agent_context_is_ungoverned_by_default():
    """No identity_scope at all (matches every other test in this file) --
    must behave exactly as before this feature existed."""
    bot = ClaudeCodeCliBot()
    with patch("subprocess.run", return_value=_fake_proc(stdout='{"result": "ok"}')) as run:
        bot.call_with_tools([{"role": "user", "content": "go"}])
    assert "--disallowedTools" not in run.call_args[0][0]
    assert bot.last_call_governed is False


def test_an_agent_without_require_approval_for_writes_is_ungoverned(registry_with_governed_agent):
    bot = ClaudeCodeCliBot()
    with identity_scope(agent_id="open"):
        with patch("subprocess.run", return_value=_fake_proc(stdout='{"result": "ok"}')) as run:
            bot.call_with_tools([{"role": "user", "content": "go"}])
    assert "--disallowedTools" not in run.call_args[0][0]
    assert bot.last_call_governed is False


def test_an_agent_with_require_approval_for_writes_gets_disallowed_tools(registry_with_governed_agent):
    bot = ClaudeCodeCliBot()
    with identity_scope(agent_id="governed"):
        with patch("subprocess.run", return_value=_fake_proc(stdout='{"result": "ok"}')) as run:
            bot.call_with_tools([{"role": "user", "content": "go"}])
    called_args = run.call_args[0][0]
    assert "--disallowedTools" in called_args
    idx = called_args.index("--disallowedTools")
    assert "Bash" in called_args[idx + 1]
    assert "Write" in called_args[idx + 1]
    assert bot.last_call_governed is True


def test_registry_lookup_failure_degrades_to_ungoverned():
    """An approval-gate malfunction must never silently start blocking every
    call -- same fallback contract as execution_gate.py's own requires_approval."""
    bot = ClaudeCodeCliBot()
    with identity_scope(agent_id="does-not-exist"):
        with patch("subprocess.run", return_value=_fake_proc(stdout='{"result": "ok"}')) as run:
            bot.call_with_tools([{"role": "user", "content": "go"}])
    assert "--disallowedTools" not in run.call_args[0][0]
    assert bot.last_call_governed is False
