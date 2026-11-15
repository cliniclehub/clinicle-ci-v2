# encoding:utf-8
"""channel/web/api/config.py: the "Runtimes & Automation" Settings card --
enable_cost_tracking, the global watchdog defaults, and the Claude Code CLI
runtime path/cwd/timeout. All six were previously readable only via
conf().get(...) with no Settings UI and no save-endpoint allowlist entry
(hand-edit config.json or nothing) -- this proves each one now round-trips
through the same GET/POST the rest of the General settings pane uses, and
that the CLI runtime is actually selectable as a per-agent model."""

import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

try:
    import web  # noqa: F401
except ImportError:
    web_stub = types.ModuleType("web")
    web_stub.ctx = types.SimpleNamespace(env={})
    web_stub.HTTPError = type("HTTPError", (Exception,), {})
    web_stub.cookies = lambda: {}
    web_stub.header = lambda *args, **kwargs: None
    web_stub.data = lambda: b"{}"
    web_stub.input = lambda **kwargs: types.SimpleNamespace(**kwargs)
    web_stub.setcookie = lambda *args, **kwargs: None
    web_stub.seeother = lambda *args, **kwargs: Exception("seeother")
    web_stub.notfound = lambda *args, **kwargs: Exception("notfound")
    web_stub.badrequest = lambda *args, **kwargs: Exception("badrequest")
    web_stub.application = lambda *args, **kwargs: types.SimpleNamespace(wsgifunc=lambda: None)
    web_stub.httpserver = types.SimpleNamespace(
        LogMiddleware=type("LogMiddleware", (), {"log": lambda *args, **kwargs: None}),
        StaticMiddleware=lambda app: app,
        WSGIServer=lambda *args, **kwargs: types.SimpleNamespace(serve_forever=lambda: None),
    )
    sys.modules["web"] = web_stub

from channel.web.api import config as config_api

ROOT = Path(__file__).parents[1]


def _post(tmp_path, updates, stored=None, runtime=None):
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(stored or {}), encoding="utf-8")
    live = runtime if runtime is not None else {}

    with patch("channel.web.api.config._require_auth"), \
         patch("agent.tenancy.store.get_tenancy_store",
               return_value=types.SimpleNamespace(has_any_user=lambda: False)), \
         patch("channel.web.api.config.web.header"), \
         patch("channel.web.api.config.web.data",
               return_value=json.dumps({"updates": updates}).encode()), \
         patch("channel.web.api.config.conf", return_value=live), \
         patch("channel.web.api.config.get_data_root", return_value=str(tmp_path)), \
         patch("channel.web.api.config._read_config_file_for_write",
               return_value=json.loads(config_path.read_text(encoding="utf-8"))):
        response = json.loads(config_api.ConfigHandler().POST())

    return response, json.loads(config_path.read_text(encoding="utf-8")), live


def _get(stored):
    with patch("channel.web.api.config._require_auth"), \
         patch("agent.tenancy.store.get_tenancy_store",
               return_value=types.SimpleNamespace(has_any_user=lambda: False)), \
         patch("channel.web.api.config.web.header"), \
         patch("channel.web.api.config.conf", return_value=stored), \
         patch("agent.evolution.config.get_evolution_config",
               return_value=types.SimpleNamespace(enabled=False)), \
         patch("agent.subagent.SubagentSettings.from_config",
               return_value=types.SimpleNamespace(enabled=True)):
        return json.loads(config_api.ConfigHandler().GET())


def test_enable_cost_tracking_round_trips(tmp_path):
    response, saved, live = _post(tmp_path, {"enable_cost_tracking": True})
    assert response["status"] == "success"
    assert saved["enable_cost_tracking"] is True
    assert live["enable_cost_tracking"] is True


def test_watchdog_globals_round_trip_as_integers(tmp_path):
    response, saved, live = _post(tmp_path, {
        "watchdog_stall_threshold_seconds": "600", "watchdog_max_nudges_per_session": "3",
    })
    assert response["status"] == "success"
    assert saved["watchdog_stall_threshold_seconds"] == 600
    assert saved["watchdog_max_nudges_per_session"] == 3
    assert live["watchdog_stall_threshold_seconds"] == 600


def test_cli_runtime_fields_round_trip(tmp_path):
    response, saved, live = _post(tmp_path, {
        "claude_code_cli_path": "/usr/local/bin/claude",
        "claude_code_cli_cwd": "/srv/agent",
        "claude_code_cli_timeout_seconds": "120",
    })
    assert response["status"] == "success"
    assert saved["claude_code_cli_path"] == "/usr/local/bin/claude"
    assert saved["claude_code_cli_cwd"] == "/srv/agent"
    assert saved["claude_code_cli_timeout_seconds"] == 120
    assert live["claude_code_cli_timeout_seconds"] == 120


def test_codex_cli_runtime_fields_round_trip(tmp_path):
    response, saved, live = _post(tmp_path, {
        "codex_cli_path": "/usr/local/bin/codex",
        "codex_cli_cwd": "/srv/agent",
        "codex_cli_timeout_seconds": "120",
    })
    assert response["status"] == "success"
    assert saved["codex_cli_path"] == "/usr/local/bin/codex"
    assert saved["codex_cli_cwd"] == "/srv/agent"
    assert saved["codex_cli_timeout_seconds"] == 120
    assert live["codex_cli_timeout_seconds"] == 120


def test_browser_cdp_endpoint_round_trips_without_touching_sibling_tool_fields(tmp_path):
    """The write must merge into tools.browser, not replace it -- a
    hand-set sibling field (e.g. allow_private_targets) under the same
    object must survive a save that only touches cdp_endpoint."""
    stored = {"tools": {"browser": {"allow_private_targets": True}, "other_tool": {"x": 1}}}
    response, saved, live = _post(tmp_path, {"browser_cdp_endpoint": "http://localhost:9222"}, stored=stored)
    assert response["status"] == "success"
    assert saved["tools"]["browser"]["cdp_endpoint"] == "http://localhost:9222"
    assert saved["tools"]["browser"]["allow_private_targets"] is True
    assert saved["tools"]["other_tool"] == {"x": 1}
    assert live["tools"]["browser"]["cdp_endpoint"] == "http://localhost:9222"


def test_browser_cdp_endpoint_get_reflects_the_nested_config_value():
    data = _get({"tools": {"browser": {"cdp_endpoint": "http://localhost:9222"}}})
    assert data["browser_cdp_endpoint"] == "http://localhost:9222"


def test_browser_cdp_endpoint_defaults_to_empty_string():
    data = _get({})
    assert data["browser_cdp_endpoint"] == ""


def test_custom_css_round_trips(tmp_path):
    response, saved, live = _post(tmp_path, {"custom_css": ".sidebar { color: red; }"})
    assert response["status"] == "success"
    assert saved["custom_css"] == ".sidebar { color: red; }"
    assert live["custom_css"] == ".sidebar { color: red; }"


def test_custom_css_over_the_size_cap_is_rejected(tmp_path):
    response, saved, live = _post(tmp_path, {"custom_css": "x" * 50_001})
    assert response["status"] == "error"
    assert "custom_css" not in saved


def test_custom_css_at_exactly_the_size_cap_is_accepted(tmp_path):
    response, saved, live = _post(tmp_path, {"custom_css": "x" * 50_000})
    assert response["status"] == "success"
    assert saved["custom_css"] == "x" * 50_000


def test_get_returns_sensible_defaults_for_a_fresh_install():
    data = _get({})
    assert data["enable_cost_tracking"] is False
    assert data["watchdog_stall_threshold_seconds"] == 900
    assert data["watchdog_max_nudges_per_session"] == 2
    assert data["claude_code_cli_path"] == ""
    assert data["claude_code_cli_cwd"] == ""
    assert data["claude_code_cli_timeout_seconds"] == 300
    assert data["custom_css"] == ""


def test_get_reflects_a_hand_edited_config_value():
    """A value nothing but a direct config.json edit ever set must still show
    up correctly here -- that was the whole gap being closed."""
    data = _get({"enable_cost_tracking": True, "claude_code_cli_path": "claude-beta"})
    assert data["enable_cost_tracking"] is True
    assert data["claude_code_cli_path"] == "claude-beta"


def test_the_settings_are_exposed_by_the_web_console():
    from conftest import console_js
    from channel.web.core import template

    web_markup = template.render("chat.html")
    web_console = console_js()

    for key in (
        "enable_cost_tracking", "watchdog_stall_threshold_seconds",
        "watchdog_max_nudges_per_session", "claude_code_cli_path",
        "claude_code_cli_cwd", "claude_code_cli_timeout_seconds",
        "codex_cli_path", "codex_cli_cwd", "codex_cli_timeout_seconds",
    ):
        assert key in config_api.ConfigHandler.EDITABLE_KEYS, f"{key} missing from EDITABLE_KEYS"

    assert 'id="cfg-cost-tracking"' in web_markup
    assert 'id="cfg-watchdog-threshold"' in web_markup
    assert 'id="cfg-cli-path"' in web_markup
    assert 'id="cfg-codex-cli-path"' in web_markup
    assert 'id="cfg-browser-cdp-endpoint"' in web_markup
    assert "function saveRuntimesConfig()" in web_console
    assert "enable_cost_tracking: document.getElementById('cfg-cost-tracking').checked" in web_console
    assert "codex_cli_path: document.getElementById('cfg-codex-cli-path').value.trim()" in web_console
    assert "browser_cdp_endpoint: document.getElementById('cfg-browser-cdp-endpoint').value.trim()" in web_console


def test_claude_code_cli_is_selectable_as_a_per_agent_model():
    agents_js = (ROOT / "channel/web/static/js/views/agents.js").read_text(encoding="utf-8")
    assert "claude_code_cli|cli" in agents_js


def test_codex_cli_is_selectable_as_a_per_agent_model():
    agents_js = (ROOT / "channel/web/static/js/views/agents.js").read_text(encoding="utf-8")
    assert "codex_cli|cli" in agents_js


