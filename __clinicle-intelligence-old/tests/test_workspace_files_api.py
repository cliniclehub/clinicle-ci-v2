# encoding:utf-8
"""channel/web/api/workspace_files.py: the HTTP surface over
agent/workspace/file_browser.py and the Bash tool's terminal reuse.
_require_capability is real here (not mocked away) so the settings.security
gate is actually exercised, matching this being the most sensitive surface
in the app."""

import json
from unittest.mock import patch

import pytest
import web

from agent.registry import AgentProfile, AgentRegistry, set_agent_registry
from agent.workspace import terminal_session
from channel.web.api.workspace_files import (
    WorkspaceFileHandler, WorkspaceTerminalHandler, WorkspaceTreeHandler,
)


@pytest.fixture(autouse=True)
def _clean_terminal_sessions():
    yield
    for session in list(terminal_session._SESSIONS.values()):
        session.close()
    terminal_session._SESSIONS.clear()


@pytest.fixture
def workspace_agent(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "a.py").write_text("x = 1\n")
    registry = AgentRegistry(
        [AgentProfile("wa", "Workspace Agent", str(root))], default_agent_id="wa",
    )
    set_agent_registry(registry)
    try:
        yield root
    finally:
        set_agent_registry(None)


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


def _patched(capability_ok=True):
    require_auth = patch("channel.web.api.workspace_files._require_auth")
    if capability_ok:
        require_cap = patch("channel.web.api.workspace_files._require_capability")
    else:
        def _deny(cap):
            web.ctx.status = "403 Forbidden"
            raise web.HTTPError(
                "403 Forbidden", {"Content-Type": "application/json"},
                json.dumps({"status": "error", "message": f"{cap} capability required"}),
            )
        require_cap = patch("channel.web.api.workspace_files._require_capability", side_effect=_deny)
    return patch("channel.web.api.workspace_files.web.header"), require_auth, require_cap


def test_tree_lists_the_agents_workspace(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="")):
        response = json.loads(WorkspaceTreeHandler().GET())

    assert response["status"] == "success"
    assert [e["name"] for e in response["entries"]] == ["a.py"]


def test_tree_rejects_an_unknown_agent():
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="nope", path="")):
        response = json.loads(WorkspaceTreeHandler().GET())

    assert response["status"] == "error"


def test_read_and_write_a_file_round_trip(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="a.py")):
        response = json.loads(WorkspaceFileHandler().GET())
    assert response["content"] == "x = 1\n"

    with p1, p2, p3, \
         patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="a.py")), \
         patch("channel.web.api.workspace_files.web.data", return_value=json.dumps({"content": "x = 42\n"})):
        response = json.loads(WorkspaceFileHandler().PUT())
    assert response["status"] == "success"
    assert (workspace_agent / "a.py").read_text() == "x = 42\n"


def test_write_outside_the_workspace_is_rejected(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, \
         patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="../escape.txt")), \
         patch("channel.web.api.workspace_files.web.data", return_value=json.dumps({"content": "pwned"})):
        response = json.loads(WorkspaceFileHandler().PUT())
    assert response["status"] == "error"
    assert not (workspace_agent.parent / "escape.txt").exists()


def test_delete_removes_the_file(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="a.py")):
        response = json.loads(WorkspaceFileHandler().DELETE())

    assert response["status"] == "success"
    assert not (workspace_agent / "a.py").exists()


def test_delete_outside_the_workspace_is_rejected(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="../escape.txt")):
        response = json.loads(WorkspaceFileHandler().DELETE())

    assert response["status"] == "error"


def test_terminal_runs_a_command_in_the_agents_workspace(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": "cat a.py"}),
    ):
        response = json.loads(WorkspaceTerminalHandler().POST())

    assert response["status"] == "success"
    assert "x = 1" in response["output"]


def test_terminal_persists_cwd_across_separate_calls(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": "cd sub 2>/dev/null || mkdir sub && cd sub"}),
    ):
        json.loads(WorkspaceTerminalHandler().POST())

    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": "pwd"}),
    ):
        response = json.loads(WorkspaceTerminalHandler().POST())
    assert response["output"].strip().endswith("/sub")


def test_terminal_delete_resets_the_shell(workspace_agent):
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": "export CE_TEST_VAR=hello"}),
    ):
        json.loads(WorkspaceTerminalHandler().POST())

    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa")):
        response = json.loads(WorkspaceTerminalHandler().DELETE())
    assert response["status"] == "success"

    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": "echo $CE_TEST_VAR"}),
    ):
        response = json.loads(WorkspaceTerminalHandler().POST())
    assert response["output"].strip() == ""


def test_terminal_requires_a_command():
    p1, p2, p3 = _patched()
    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": ""}),
    ):
        response = json.loads(WorkspaceTerminalHandler().POST())
    assert response["status"] == "error"


def test_endpoints_are_gated_on_settings_security_capability(workspace_agent):
    """The one property that actually matters here: a session that lacks
    the capability must never see workspace contents or run a command,
    regardless of which handler or verb."""
    p1, p2, p3 = _patched(capability_ok=False)
    with p1, p2, p3, patch("channel.web.api.workspace_files.web.input", return_value=web.storage(agent_id="wa", path="")):
        with pytest.raises(web.HTTPError):
            WorkspaceTreeHandler().GET()

    with p1, p2, p3, patch(
        "channel.web.api.workspace_files.web.data",
        return_value=json.dumps({"agent_id": "wa", "command": "echo hi"}),
    ):
        with pytest.raises(web.HTTPError):
            WorkspaceTerminalHandler().POST()
