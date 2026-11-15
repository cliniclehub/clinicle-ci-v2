# encoding:utf-8
"""ToolManager.sync_composio_into_agent: reconciles a live agent's tool
collection with the current org's connected Composio apps — one real tool
per action (not a generic proxy), TTL-cached, org-scoped, mirroring
sync_mcp_into_agent's exact add/remove shape."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agent.tools.tool_manager import ToolManager
from common.runtime_identity import RuntimeIdentity, use_identity
from config import conf


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "test-key")


@pytest.fixture
def manager():
    tm = ToolManager.__new__(ToolManager)
    tm._composio_tool_cache = {}
    return tm


def _toolkit_item(slug, connected=True):
    item = MagicMock()
    item.slug = slug
    if connected:
        item.connection = MagicMock(is_active=True)
    else:
        item.connection = None
    return item


def _raw_tool(slug):
    return SimpleNamespace(
        slug=slug, description="", input_parameters={"type": "object", "properties": {}}
    )


def _mock_client(connected_slugs, tool_names):
    """One base session for the connected-toolkits listing, plus the raw
    tool list get_raw_composio_tools returns for those toolkits."""
    base_session = MagicMock()
    base_session.toolkits.return_value = MagicMock(
        items=[_toolkit_item(s) for s in connected_slugs]
    )

    client = MagicMock()
    client.create.return_value = base_session
    client.tools.get_raw_composio_tools.return_value = [_raw_tool(n) for n in tool_names]
    return MagicMock(return_value=client), client


def test_no_op_without_api_key(manager, monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "")
    agent = SimpleNamespace(tools={})
    added, removed = manager.sync_composio_into_agent(agent)
    assert added == [] and removed == []


def test_no_connected_apps_adds_nothing(manager):
    composio_cls, client = _mock_client(connected_slugs=[], tool_names=[])
    agent = SimpleNamespace(tools={})
    with patch("composio.Composio", composio_cls):
        added, removed = manager.sync_composio_into_agent(agent)
    assert added == [] and removed == []
    assert agent.tools == {}


def test_adds_one_real_tool_per_connected_apps_action(manager):
    composio_cls, client = _mock_client(
        connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE", "SLACK_LIST_CHANNELS"],
    )
    agent = SimpleNamespace(tools={})
    with patch("composio.Composio", composio_cls):
        added, removed = manager.sync_composio_into_agent(agent)

    assert sorted(added) == ["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"]
    assert removed == []
    assert set(agent.tools.keys()) == {"SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"}
    from agent.tools.connectors.composio_tool import ComposioTool
    assert all(isinstance(t, ComposioTool) for t in agent.tools.values())


def test_disconnecting_an_app_removes_its_tools_on_next_sync(manager):
    composio_cls, client = _mock_client(
        connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"],
    )
    agent = SimpleNamespace(tools={})
    with patch("composio.Composio", composio_cls):
        manager.sync_composio_into_agent(agent)
    assert "SLACK_SEND_MESSAGE" in agent.tools

    manager._composio_tool_cache.clear()
    composio_cls2, _client2 = _mock_client(connected_slugs=[], tool_names=[])
    with patch("composio.Composio", composio_cls2):
        added, removed = manager.sync_composio_into_agent(agent, cache_ttl_seconds=0)

    assert removed == ["SLACK_SEND_MESSAGE"]
    assert agent.tools == {}


def test_two_orgs_never_share_tool_sets(manager):
    slack_cls, _c1 = _mock_client(connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"])
    github_cls, _c2 = _mock_client(connected_slugs=["github"], tool_names=["GITHUB_LIST_REPOS"])

    agent_a = SimpleNamespace(tools={})
    with use_identity(RuntimeIdentity(org_id="a")):
        with patch("composio.Composio", slack_cls):
            manager.sync_composio_into_agent(agent_a)

    agent_b = SimpleNamespace(tools={})
    with use_identity(RuntimeIdentity(org_id="b")):
        with patch("composio.Composio", github_cls):
            manager.sync_composio_into_agent(agent_b)

    assert set(agent_a.tools.keys()) == {"SLACK_SEND_MESSAGE"}
    assert set(agent_b.tools.keys()) == {"GITHUB_LIST_REPOS"}


def test_cache_avoids_a_second_api_call_within_ttl(manager):
    composio_cls, client = _mock_client(connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"])
    agent = SimpleNamespace(tools={})
    with patch("composio.Composio", composio_cls):
        manager.sync_composio_into_agent(agent, cache_ttl_seconds=60)
        manager.sync_composio_into_agent(agent, cache_ttl_seconds=60)
    # create() + get_raw_composio_tools() happen only on the first sync; the
    # second sync must hit the cache, not call the API again.
    assert client.create.call_count == 1
    assert client.tools.get_raw_composio_tools.call_count == 1


def test_evolution_restricted_agent_is_never_touched(manager):
    agent = SimpleNamespace(tools={}, _evolution_restricted=True)
    composio_cls, _client = _mock_client(connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"])
    with patch("composio.Composio", composio_cls):
        added, removed = manager.sync_composio_into_agent(agent)
    assert added == [] and removed == []
    assert agent.tools == {}


def test_list_shaped_agent_tools_are_supported_too(manager):
    composio_cls, _client = _mock_client(connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"])
    agent = SimpleNamespace(tools=[])
    with patch("composio.Composio", composio_cls):
        added, removed = manager.sync_composio_into_agent(agent)
    assert added == ["SLACK_SEND_MESSAGE"]
    assert len(agent.tools) == 1
    assert agent.tools[0].name == "SLACK_SEND_MESSAGE"


def _catalog_entry(slug, toolkit):
    return {
        "slug": slug, "description": "", "input_parameters": {},
        "version": "20260101_00", "toolkit": toolkit,
    }


def test_full_catalog_mode_unions_every_catalog_tool(manager, monkeypatch):
    """Catalog mode on: every catalog tool is registered (connected or not),
    with `connected` marking which apps this org can actually execute."""
    import threading
    import time

    monkeypatch.setitem(conf(), "composio_catalog_tools_enabled", True)
    # Pre-populate a FRESH catalog so _ensure_composio_catalog returns
    # without spawning the background loader thread.
    manager._composio_catalog = {
        "SLACK_SEND_MESSAGE": _catalog_entry("SLACK_SEND_MESSAGE", "slack"),
        "NOTION_CREATE_PAGE": _catalog_entry("NOTION_CREATE_PAGE", "notion"),
    }
    manager._composio_catalog_fetched_at = time.time()
    manager._composio_catalog_loading = False
    manager._composio_catalog_lock = threading.Lock()

    composio_cls, _client = _mock_client(
        connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"],
    )
    agent = SimpleNamespace(tools={})
    with patch("composio.Composio", composio_cls):
        added, removed = manager.sync_composio_into_agent(agent)

    assert set(agent.tools.keys()) == {"SLACK_SEND_MESSAGE", "NOTION_CREATE_PAGE"}
    assert agent.tools["SLACK_SEND_MESSAGE"].connected is True
    assert agent.tools["NOTION_CREATE_PAGE"].connected is False
    assert sorted(added) == ["NOTION_CREATE_PAGE", "SLACK_SEND_MESSAGE"]


def test_catalog_mode_off_registers_connected_apps_only(manager, monkeypatch):
    monkeypatch.setitem(conf(), "composio_catalog_tools_enabled", False)
    composio_cls, _client = _mock_client(connected_slugs=["slack"], tool_names=["SLACK_SEND_MESSAGE"])
    manager._composio_catalog = {"NOTION_CREATE_PAGE": _catalog_entry("NOTION_CREATE_PAGE", "notion")}
    agent = SimpleNamespace(tools={})
    with patch("composio.Composio", composio_cls):
        manager.sync_composio_into_agent(agent)
    assert set(agent.tools.keys()) == {"SLACK_SEND_MESSAGE"}
