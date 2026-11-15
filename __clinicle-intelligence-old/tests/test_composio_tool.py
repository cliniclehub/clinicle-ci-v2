# encoding:utf-8
"""ComposioTool: wraps one raw Composio action (from
``client.tools.get_raw_composio_tools``) as a real BaseTool with its own
name/description/params — not a generic proxy. Executes through
``client.tools.execute(slug, ..., user_id=...)`` so the call routes through
the org's connected account."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from agent.tools.connectors.composio_tool import ComposioTool


def _raw_tool(slug="SLACK_SEND_MESSAGE", description="Send a Slack message", parameters=None):
    return SimpleNamespace(
        slug=slug,
        description=description,
        input_parameters=parameters if parameters is not None else {
            "type": "object",
            "properties": {"channel": {"type": "string"}, "text": {"type": "string"}},
            "required": ["channel", "text"],
        },
    )


def _tool(client=None, raw=None):
    return ComposioTool(client or MagicMock(), "org-test", raw or _raw_tool())


def test_extracts_real_name_description_and_schema():
    tool = _tool()
    assert tool.name == "SLACK_SEND_MESSAGE"
    assert tool.description == "Send a Slack message"
    assert tool.params["properties"]["channel"]["type"] == "string"
    assert tool.params["required"] == ["channel", "text"]


def test_execute_calls_client_with_this_tools_own_slug_and_org():
    client = MagicMock()
    client.tools.execute.return_value = {"data": {"ok": True}, "error": None, "successful": True}
    tool = _tool(client=client)

    result = tool.execute({"channel": "#general", "text": "hi"})

    client.tools.execute.assert_called_once_with(
        "SLACK_SEND_MESSAGE", arguments={"channel": "#general", "text": "hi"}, user_id="org-test",
    )
    assert result.status == "success"
    assert result.result == {"ok": True}


def test_execute_surfaces_a_tool_level_error():
    client = MagicMock()
    client.tools.execute.return_value = {"data": None, "error": "rate limited", "successful": False}
    tool = _tool(client=client)

    result = tool.execute({})

    assert result.status == "error"
    assert "rate limited" in result.result


def test_execute_surfaces_an_exception():
    client = MagicMock()
    client.tools.execute.side_effect = RuntimeError("boom")
    tool = _tool(client=client)

    result = tool.execute({})

    assert result.status == "error"


def test_missing_parameters_defaults_to_empty_object_schema():
    raw = _raw_tool()
    raw.input_parameters = None
    tool = _tool(raw=raw)
    assert tool.params == {"type": "object", "properties": {}}


def test_execute_passes_the_toolkit_version():
    """Manual client.tools.execute raises ToolVersionRequiredError without an
    explicit version — the raw tool's own version must be forwarded."""
    client = MagicMock()
    client.tools.execute.return_value = {"data": {}, "error": None, "successful": True}
    raw = _raw_tool()
    raw.version = "20260915_00"
    raw.toolkit = SimpleNamespace(slug="slack")
    tool = _tool(client=client, raw=raw)

    tool.execute({})

    assert client.tools.execute.call_args.kwargs["version"] == "20260915_00"


def test_unconnected_app_returns_a_connect_link_hint():
    """The whole point of full-catalog mode: the agent can tell the user how
    to connect the app it just tried to use."""
    client = MagicMock()
    client.tools.execute.side_effect = RuntimeError(
        "Error code: 404 - ActionExecute_ConnectedAccountNotFound: "
        "No connected account found for user ID default for toolkit gmail"
    )
    client.create.return_value.authorize.return_value = SimpleNamespace(
        redirect_url="https://connect.composio.dev/link/abc"
    )
    raw = _raw_tool()
    raw.toolkit = SimpleNamespace(slug="gmail")
    tool = _tool(client=client, raw=raw)

    result = tool.execute({})

    assert result.status == "error"
    assert "gmail" in result.result
    assert "https://connect.composio.dev/link/abc" in result.result
    client.create.return_value.authorize.assert_called_once_with("gmail")


def test_unconnected_app_falls_back_to_connectors_page_when_mint_fails():
    client = MagicMock()
    client.tools.execute.side_effect = RuntimeError("No connected account found")
    client.create.side_effect = RuntimeError("mint failed")
    raw = _raw_tool()
    raw.toolkit = SimpleNamespace(slug="gmail")
    tool = _tool(client=client, raw=raw)

    result = tool.execute({})

    assert result.status == "error"
    assert "Connectors page" in result.result


def test_tools_start_as_not_connected_until_sync_marks_them():
    assert _tool().connected is False
