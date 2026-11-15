# encoding:utf-8
"""The Connect flow API: session minting, listing, deletion — mocked at the
composio.Composio boundary, no live account needed. Real WSGI server + real
HTTP request (same style as test_upload_agent_scope.py /
test_identity_processor.py) so the auth/identity wiring is exercised for
real, not assumed.
"""

import json
import threading
import urllib.error
import urllib.request
from unittest.mock import MagicMock, patch
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest

from channel.web.core.tenancy_session import create_session_token
from config import conf


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def server(tmp_path, monkeypatch):
    from channel.web import web_channel
    from channel.web.core import tenancy_session

    monkeypatch.setattr(tenancy_session, "_secret_path", lambda: tmp_path / "session_secret")
    monkeypatch.setitem(conf(), "composio_api_key", "test-composio-key")

    from agent.tenancy import store as tenancy_store_mod
    tenancy_store_mod._instance = None
    monkeypatch.setattr(tenancy_store_mod, "_default_db_path", lambda: tmp_path / "platform.db")
    store = tenancy_store_mod.get_tenancy_store()

    app = web_channel.build_app()
    httpd = make_server("127.0.0.1", 0, app.wsgifunc(), handler_class=_QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield type("Server", (), {"base_url": f"http://127.0.0.1:{httpd.server_address[1]}", "store": store})()
    finally:
        httpd.shutdown()


def _request(base_url, method, path, token=None, body=None):
    req = urllib.request.Request(f"{base_url}{path}", method=method)
    if token:
        req.add_header("Cookie", f"cow_auth_token={token}")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    req.data = data
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except Exception:
            return error.code, {}


def _toolkit_item(slug, name, connected, connected_account_id=None):
    item = MagicMock()
    item.slug = slug
    item.name = name
    if connected:
        item.connection = MagicMock()
        item.connection.is_active = True
        if connected_account_id:
            item.connection.connected_account = MagicMock(id=connected_account_id)
        else:
            item.connection.connected_account = None
    else:
        item.connection = None
    return item


def _mock_composio(toolkits_result=None, authorize_result=None):
    session = MagicMock()
    if toolkits_result is not None:
        session.toolkits.return_value = toolkits_result
    if authorize_result is not None:
        session.authorize.return_value = authorize_result
    client = MagicMock()
    client.create.return_value = session
    return MagicMock(return_value=client), client, session


def test_list_requires_configuration(server, monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "")
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    status, payload = _request(server.base_url, "GET", "/api/connectors", token=token)
    assert status == 200
    assert payload["status"] == "error"


def test_empty_list_for_a_fresh_org(server):
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    result = MagicMock(items=[])
    composio_cls, client, session = _mock_composio(toolkits_result=result)
    with patch("composio.Composio", composio_cls):
        status, payload = _request(server.base_url, "GET", "/api/connectors", token=token)
    assert status == 200
    assert payload == {"status": "success", "connections": []}


def test_list_shows_only_active_connections(server):
    token = create_session_token(user_id=1, org_id=7, expire_seconds=3600)
    result = MagicMock(items=[
        _toolkit_item("slack", "Slack", connected=True),
        _toolkit_item("github", "GitHub", connected=False),
    ])
    _cls, client, session = _mock_composio(toolkits_result=result)
    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(server.base_url, "GET", "/api/connectors", token=token)
    assert status == 200
    assert [c["provider"] for c in payload["connections"]] == ["slack"]
    client.create.assert_called_with(user_id="org-7")


def test_session_mint_calls_composio_and_returns_redirect(server):
    token = create_session_token(user_id=1, org_id=7, expire_seconds=3600)
    connection_request = MagicMock(redirect_url="https://connect.composio.dev/x")
    _cls, client, session = _mock_composio(authorize_result=connection_request)
    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(
            server.base_url, "POST", "/api/connectors/sessions", token=token, body={"provider": "slack"},
        )
    assert status == 200
    assert payload == {"status": "success", "connect_link": "https://connect.composio.dev/x"}
    session.authorize.assert_called_once_with("slack")
    client.create.assert_called_once_with(user_id="org-7")


def test_session_mint_requires_provider(server):
    token = create_session_token(user_id=1, org_id=7, expire_seconds=3600)
    status, payload = _request(
        server.base_url, "POST", "/api/connectors/sessions", token=token, body={},
    )
    assert payload["status"] == "error"


def test_two_orgs_get_different_user_ids_on_list(server):
    token_a = create_session_token(user_id=1, org_id=3, expire_seconds=3600)
    token_b = create_session_token(user_id=2, org_id=9, expire_seconds=3600)
    result = MagicMock(items=[])
    _cls, client, session = _mock_composio(toolkits_result=result)
    with patch("composio.Composio", MagicMock(return_value=client)):
        _request(server.base_url, "GET", "/api/connectors", token=token_a)
        _request(server.base_url, "GET", "/api/connectors", token=token_b)
    seen_user_ids = [c.kwargs["user_id"] for c in client.create.call_args_list]
    assert seen_user_ids == ["org-3", "org-9"]


def test_delete_removes_a_connection(server):
    token = create_session_token(user_id=1, org_id=9, expire_seconds=3600)
    result = MagicMock(items=[_toolkit_item("notion", "Notion", connected=True, connected_account_id="acc-123")])
    _cls, client, session = _mock_composio(toolkits_result=result)
    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(server.base_url, "DELETE", "/api/connectors/notion", token=token)
    assert status == 200
    assert payload["status"] == "success"
    client.connected_accounts.delete.assert_called_once_with("acc-123", revoke_on_delete=True)


def test_delete_not_connected_returns_error(server):
    token = create_session_token(user_id=1, org_id=9, expire_seconds=3600)
    result = MagicMock(items=[])
    _cls, client, session = _mock_composio(toolkits_result=result)
    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(server.base_url, "DELETE", "/api/connectors/notion", token=token)
    assert payload["status"] == "error"


def _catalog_item(slug, name, description="", logo=""):
    item = MagicMock()
    item.slug = slug
    item.name = name
    item.meta = MagicMock(description=description, logo=logo)
    return item


def test_catalog_requires_configuration(server, monkeypatch):
    monkeypatch.setitem(conf(), "composio_api_key", "")
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    status, payload = _request(server.base_url, "GET", "/api/connectors/catalog", token=token)
    assert status == 200
    assert payload["status"] == "error"


def test_catalog_returns_the_app_list_not_the_connections_list(server):
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    client = MagicMock()
    client.toolkits.get.return_value = [
        _catalog_item("slack", "Slack", description="Team chat", logo="https://x/slack.png"),
        _catalog_item("github", "GitHub", description="Code hosting", logo="https://x/github.png"),
    ]
    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(server.base_url, "GET", "/api/connectors/catalog", token=token)
    assert status == 200
    assert payload == {
        "status": "success",
        "apps": [
            {"slug": "slack", "name": "Slack", "description": "Team chat", "logo": "https://x/slack.png"},
            {"slug": "github", "name": "GitHub", "description": "Code hosting", "logo": "https://x/github.png"},
        ],
    }
    client.toolkits.get.assert_called_once_with(query={"limit": 30, "sort_by": "usage"})


def test_catalog_passes_search_through(server):
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    client = MagicMock()
    client.toolkits.get.return_value = []
    with patch("composio.Composio", MagicMock(return_value=client)):
        _request(server.base_url, "GET", "/api/connectors/catalog?search=slack", token=token)
    client.toolkits.get.assert_called_once_with(query={"limit": 30, "sort_by": "usage", "search": "slack"})


def test_catalog_pagination_and_categories(server):
    from channel.web.api.connectors import _CATALOG_CACHE
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)

    # Populate dummy catalog in cache
    dummy_apps = [
        {
            "slug": f"app-{i}",
            "name": f"App {i}",
            "description": f"Description for app {i}",
            "logo": f"https://logos/{i}.png",
            "categories": ["Developer Tools"] if i % 2 == 0 else ["CRM"],
            "tools_count": i * 5,
            "auth_schemes": ["OAUTH2"],
        }
        for i in range(120)
    ]
    with _CATALOG_CACHE["lock"]:
        _CATALOG_CACHE["toolkits"] = dummy_apps
        _CATALOG_CACHE["fetched_at"] = 9999999999.0

    session = MagicMock()
    session.toolkits.return_value = MagicMock(items=[])
    client = MagicMock()
    client.create.return_value = session

    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(server.base_url, "GET", "/api/connectors/catalog?page=2&limit=50", token=token)

    assert status == 200
    assert payload["status"] == "success"
    assert payload["total"] == 120
    assert payload["page"] == 2
    assert payload["limit"] == 50
    assert payload["total_pages"] == 3
    assert payload["has_more"] is True
    assert len(payload["apps"]) == 50
    assert payload["apps"][0]["slug"] == "app-50"
    assert any(c["name"] == "Developer Tools" for c in payload["categories"])

    # Test category filter
    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload_crm = _request(server.base_url, "GET", "/api/connectors/catalog?category=crm&limit=100", token=token)
    assert payload_crm["total"] == 60
    assert all("CRM" in app["categories"] for app in payload_crm["apps"])


def test_connector_tools_handler(server):
    token = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    tool_mock = MagicMock()
    tool_mock.slug = "GMAIL_SEND_EMAIL"
    tool_mock.description = "Send email"
    tool_mock.input_parameters = {"type": "object", "properties": {"to": {"type": "string"}}}
    tool_mock.version = "1.0"

    client = MagicMock()
    client.tools.get_raw_composio_tools.return_value = [tool_mock]

    with patch("composio.Composio", MagicMock(return_value=client)):
        status, payload = _request(server.base_url, "GET", "/api/connectors/tools?toolkit=gmail", token=token)

    assert status == 200
    assert payload["status"] == "success"
    assert payload["toolkit"] == "gmail"
    assert payload["count"] == 1
    assert payload["tools"][0]["slug"] == "GMAIL_SEND_EMAIL"
    assert payload["tools"][0]["parameters"]["properties"]["to"]["type"] == "string"

