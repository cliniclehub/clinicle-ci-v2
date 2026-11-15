# encoding:utf-8
"""models/codex_cli_bot.py: shells to the OpenAI Codex CLI's headless mode.
No real CLI invoked -- subprocess.run is monkeypatched to write to the
-o output file the bot itself created, since that's how the real CLI
reports its final answer."""

from unittest.mock import MagicMock, patch

import pytest

from agent.registry import AgentProfile, AgentRegistry, set_agent_registry
from common.runtime_identity import identity_scope
from models.codex_cli_bot import CodexCliBot


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


def _fake_run_writing_output(final_message, returncode=0, stderr=""):
    """Mimics `codex exec -o <file>`: real codex writes its final message to
    the file passed via -o. The fake locates that file in the argv it was
    called with and writes to it, the way a real subprocess would."""
    def _run(args, **kwargs):
        proc = MagicMock()
        proc.returncode = returncode
        proc.stdout = ""
        proc.stderr = stderr
        if returncode == 0 and "-o" in args:
            out_path = args[args.index("-o") + 1]
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(final_message)
        return proc
    return _run


def test_declares_the_disclosed_tool_loop_gap():
    assert CodexCliBot.HOST_VISIBLE_TOOL_LOOP is False
    assert CodexCliBot().HOST_VISIBLE_TOOL_LOOP is False


def test_call_with_tools_returns_a_chat_completion_shape_on_success():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=_fake_run_writing_output("Done. Fixed the bug.")):
        response = bot.call_with_tools([{"role": "user", "content": "fix the bug"}])
    assert response["choices"][0]["message"]["content"] == "Done. Fixed the bug."
    assert response["choices"][0]["finish_reason"] == "stop"


def test_ignores_the_tools_parameter_entirely():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=_fake_run_writing_output("ok")) as run:
        bot.call_with_tools([{"role": "user", "content": "go"}], tools=[{"name": "bash"}])
    called_args = run.call_args[0][0]
    assert "bash" not in " ".join(called_args)


def test_missing_cli_binary_returns_an_error_dict_not_an_exception():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=FileNotFoundError()):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["error"] is True
    assert "not found" in response["message"]


def test_timeout_returns_an_error_dict_not_an_exception():
    import subprocess as sp

    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=sp.TimeoutExpired(cmd="codex", timeout=300)):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["error"] is True
    assert "timed out" in response["message"]


def test_nonzero_exit_code_returns_an_error_dict():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=_fake_run_writing_output("", returncode=1, stderr="auth failed")):
        response = bot.call_with_tools([{"role": "user", "content": "go"}])
    assert response["error"] is True
    assert "auth failed" in response["message"]


def test_stream_true_yields_content_then_a_final_chunk():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=_fake_run_writing_output("hi")):
        chunks = list(bot.call_with_tools([{"role": "user", "content": "go"}], stream=True))
    assert chunks[0]["choices"][0]["delta"]["content"] == "hi"
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"


def test_uses_exec_subcommand_and_json_and_output_file_flags():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=_fake_run_writing_output("ok")) as run:
        bot.call_with_tools([{"role": "user", "content": "go"}])
    args = run.call_args[0][0]
    assert args[1] == "exec"
    assert "--json" in args
    assert "-o" in args


def test_output_file_is_cleaned_up_after_a_successful_call():
    bot = CodexCliBot()
    captured = {}

    def _run(args, **kwargs):
        captured["path"] = args[args.index("-o") + 1]
        return _fake_run_writing_output("ok")(args, **kwargs)

    with patch("subprocess.run", side_effect=_run):
        bot.call_with_tools([{"role": "user", "content": "go"}])
    import os
    assert not os.path.exists(captured["path"])


def test_output_file_is_cleaned_up_even_on_timeout():
    import subprocess as sp

    bot = CodexCliBot()
    captured = {}

    def _run(args, **kwargs):
        captured["path"] = args[args.index("-o") + 1]
        raise sp.TimeoutExpired(cmd="codex", timeout=300)

    with patch("subprocess.run", side_effect=_run):
        bot.call_with_tools([{"role": "user", "content": "go"}])
    import os
    assert not os.path.exists(captured["path"])


# =====================================================================
# Governance: require_approval_for_writes -> -s read-only (Codex's own
# sandbox-mode enum, not Claude Code's --disallowedTools blocklist).
# =====================================================================

def test_no_agent_context_is_ungoverned_by_default():
    bot = CodexCliBot()
    with patch("subprocess.run", side_effect=_fake_run_writing_output("ok")) as run:
        bot.call_with_tools([{"role": "user", "content": "go"}])
    assert "-s" not in run.call_args[0][0]
    assert bot.last_call_governed is False


def test_an_agent_with_require_approval_for_writes_gets_read_only_sandbox(registry_with_governed_agent):
    bot = CodexCliBot()
    with identity_scope(agent_id="governed"):
        with patch("subprocess.run", side_effect=_fake_run_writing_output("ok")) as run:
            bot.call_with_tools([{"role": "user", "content": "go"}])
    called_args = run.call_args[0][0]
    assert "-s" in called_args
    idx = called_args.index("-s")
    assert called_args[idx + 1] == "read-only"
    assert bot.last_call_governed is True


def test_an_agent_without_require_approval_for_writes_is_ungoverned(registry_with_governed_agent):
    bot = CodexCliBot()
    with identity_scope(agent_id="open"):
        with patch("subprocess.run", side_effect=_fake_run_writing_output("ok")) as run:
            bot.call_with_tools([{"role": "user", "content": "go"}])
    assert "-s" not in run.call_args[0][0]
    assert bot.last_call_governed is False
