# encoding:utf-8
"""ConnectorCallTool: request construction, org-scoping of the Composio
user_id, and gating — all mocked (the composio.Composio class), no live
Composio account needed."""

from unittest.mock import MagicMock, patch

import pytest

from agent.tools.connectors.connector_call import ConnectorCallTool
from common.runtime_identity import RuntimeIdentity, use_identity
from config import conf


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "test-composio-key")


def _mock_composio_class(execute_result):
    """Builds a mock replacing `from composio import Composio` inside the
    tool module — mirrors the real call chain: Composio(api_key=...).create(
    user_id=...).execute(tool_slug, arguments=...)."""
    session = MagicMock()
    session.execute.return_value = execute_result
    client = MagicMock()
    client.create.return_value = session
    composio_cls = MagicMock(return_value=client)
    return composio_cls, client, session


def _result(data=None, error=None):
    r = MagicMock()
    r.data = data
    r.error = error
    return r


def test_unavailable_without_api_key(monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "")
    tool = ConnectorCallTool()
    assert tool.is_available() is False


def test_available_with_api_key():
    tool = ConnectorCallTool()
    assert tool.is_available() is True


def test_requires_tool_slug():
    tool = ConnectorCallTool()
    assert tool.execute({}).status == "error"
    assert tool.execute({"tool_slug": ""}).status == "error"


def test_fails_cleanly_without_api_key(monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "")
    tool = ConnectorCallTool()
    result = tool.execute({"tool_slug": "SLACK_SEND_MESSAGE"})
    assert result.status == "error"
    assert "composio_api_key" in result.result


def test_executes_tool_with_no_org_context():
    tool = ConnectorCallTool()
    composio_cls, client, session = _mock_composio_class(_result(data={"ok": True}))
    with patch("composio.Composio", composio_cls):
        result = tool.execute({
            "tool_slug": "SLACK_SEND_MESSAGE",
            "arguments": {"channel": "#general", "text": "hi"},
        })

    assert result.status == "success"
    assert result.result == {"ok": True}
    composio_cls.assert_called_once_with(api_key="test-composio-key")
    # No org context -> collapses onto the fixed placeholder, same
    # non-breaking shape every other layer of the plan uses.
    client.create.assert_called_once_with(user_id="default")
    session.execute.assert_called_once_with(
        "SLACK_SEND_MESSAGE", arguments={"channel": "#general", "text": "hi"},
    )


def test_user_id_is_scoped_by_org():
    tool = ConnectorCallTool()
    composio_cls, client, session = _mock_composio_class(_result(data={"ok": True}))
    with use_identity(RuntimeIdentity(org_id="42")):
        with patch("composio.Composio", composio_cls):
            tool.execute({"tool_slug": "SLACK_SEND_MESSAGE"})
    client.create.assert_called_once_with(user_id="org-42")


def test_two_orgs_never_share_a_user_id():
    tool = ConnectorCallTool()
    composio_cls, client, session = _mock_composio_class(_result(data={"ok": True}))
    seen = []
    with patch("composio.Composio", composio_cls):
        for org in ("a", "b"):
            with use_identity(RuntimeIdentity(org_id=org)):
                tool.execute({"tool_slug": "GITHUB_LIST_REPOS"})
            seen.append(client.create.call_args.kwargs["user_id"])
    assert seen == ["org-a", "org-b"]
    assert seen[0] != seen[1]


def test_tool_error_becomes_a_failed_tool_result():
    tool = ConnectorCallTool()
    composio_cls, client, session = _mock_composio_class(_result(error="not authorized"))
    with patch("composio.Composio", composio_cls):
        result = tool.execute({"tool_slug": "SLACK_SEND_MESSAGE"})
    assert result.status == "error"
    assert "not authorized" in result.result


def test_sdk_exception_becomes_a_failed_tool_result():
    tool = ConnectorCallTool()
    composio_cls = MagicMock(side_effect=RuntimeError("boom"))
    with patch("composio.Composio", composio_cls):
        result = tool.execute({"tool_slug": "SLACK_SEND_MESSAGE"})
    assert result.status == "error"
