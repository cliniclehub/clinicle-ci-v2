# encoding:utf-8
"""agent/workspace/terminal_session.py: the persistent per-agent shell
backing the Code Editor's terminal. The property that matters here --
state (cd, exported vars) survives between separate run_command calls,
which a fresh-subprocess-per-command design cannot give you."""

import pytest

from agent.workspace import terminal_session


@pytest.fixture(autouse=True)
def _clean_sessions():
    terminal_session._SESSIONS.clear()
    yield
    for session in list(terminal_session._SESSIONS.values()):
        session.close()
    terminal_session._SESSIONS.clear()


def test_run_command_returns_output_and_exit_code(tmp_path):
    result = terminal_session.run_command("a1", str(tmp_path), "echo hello")
    assert result["output"] == "hello"
    assert result["exit_code"] == 0


def test_run_command_reports_a_nonzero_exit_code(tmp_path):
    # (exit 7) runs in a subshell so it doesn't kill the persistent shell itself --
    # a bare top-level "exit" legitimately would, same as in a real terminal.
    result = terminal_session.run_command("a1", str(tmp_path), "(exit 7)")
    assert result["exit_code"] == 7


def test_a_bare_exit_command_kills_the_persistent_shell(tmp_path):
    terminal_session.run_command("a1", str(tmp_path), "exit 3")
    assert not terminal_session._SESSIONS["a1"].alive()


def test_cd_persists_across_separate_calls(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir()
    terminal_session.run_command("a1", str(tmp_path), f"cd {sub}")
    result = terminal_session.run_command("a1", str(tmp_path), "pwd")
    assert result["output"].strip() == str(sub)


def test_exported_env_vars_persist_across_separate_calls(tmp_path):
    terminal_session.run_command("a1", str(tmp_path), "export CE_TEST_VAR=hello")
    result = terminal_session.run_command("a1", str(tmp_path), "echo $CE_TEST_VAR")
    assert result["output"].strip() == "hello"


def test_separate_agents_get_separate_shells(tmp_path):
    terminal_session.run_command("a1", str(tmp_path), "export CE_TEST_VAR=agent-one")
    result = terminal_session.run_command("a2", str(tmp_path), "echo $CE_TEST_VAR")
    assert result["output"].strip() == ""


def test_reset_session_starts_a_fresh_shell(tmp_path):
    terminal_session.run_command("a1", str(tmp_path), "export CE_TEST_VAR=hello")
    terminal_session.reset_session("a1")
    result = terminal_session.run_command("a1", str(tmp_path), "echo $CE_TEST_VAR")
    assert result["output"].strip() == ""


def test_reset_session_on_an_unknown_agent_is_a_no_op():
    terminal_session.reset_session("does-not-exist")
