# encoding:utf-8
"""channel/web/api/extensions.py: a manifest-driven package system for
STATIC, SAFE contributions only (theme CSS + translation strings) --
deliberately no code execution, so no sandboxing/trust model is needed.
Install/list/toggle/uninstall are admin actions (settings.general/security);
reading the merged active set is any authenticated user, same split as
CustomCssHandler."""

import json
import types
from unittest.mock import patch

import pytest
import web

from channel.web.api.extensions import (
    ExtensionActionHandler, ExtensionsActiveHandler, ExtensionsHandler,
)


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


@pytest.fixture(autouse=True)
def _no_code_sync():
    """Every test in this file exercises the manifest/HTTP layer, not the
    on-disk tool_code/channel_code/assistant_code sync (each has its own
    dedicated tests, with a real tmp_path, in test_extension_tool_sync.py /
    test_channel_factory_extensions.py / test_assistant_registry.py) --
    autouse-patching the shared entry point keeps every test here from
    touching the real get_data_root(), ToolManager.instances(),
    channel_factory, or assistant_registry."""
    with patch("channel.web.api.extensions._sync_extension_code"):
        yield


def _admin_patches():
    return (
        patch("channel.web.api.extensions._require_auth"),
        patch("channel.web.api.extensions._require_extensions_capability"),
        patch("channel.web.api.extensions.web.header"),
    )


def _denied_patches():
    def _deny():
        web.ctx.status = "403 Forbidden"
        raise web.HTTPError("403 Forbidden", {}, json.dumps({"status": "error"}))
    return (
        patch("channel.web.api.extensions._require_auth"),
        patch("channel.web.api.extensions._require_extensions_capability", side_effect=_deny),
        patch("channel.web.api.extensions.web.header"),
    )


class _StoreState:
    def __init__(self):
        self.extensions = []

    def save(self, extensions):
        self.extensions = extensions


def _with_store(state):
    return (
        patch("channel.web.api.extensions._get_extensions", side_effect=lambda: state.extensions),
        patch("channel.web.api.extensions._save_extensions", side_effect=state.save),
    )


# =====================================================================
# Manifest validation
# =====================================================================

def test_a_well_formed_manifest_installs_successfully():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {
        "name": "My Theme", "version": "1.0.0", "author": "me",
        "theme_css": ".sidebar { color: red; }",
        "strings": {"en": {"greeting": "Hi"}, "ar": {"greeting": "مرحبا"}},
    }
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()
    ):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "success"
    assert response["extension"]["id"] == "my-theme"
    assert response["extension"]["enabled"] is True
    assert len(state.extensions) == 1


def test_manifest_without_a_name_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data", return_value=json.dumps({"theme_css": "x"}).encode()
    ):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert state.extensions == []


def test_oversized_theme_css_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data",
        return_value=json.dumps({"name": "x", "theme_css": "x" * 50_001}).encode(),
    ):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"


def test_an_unsupported_language_in_strings_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data",
        return_value=json.dumps({"name": "x", "strings": {"fr": {"k": "v"}}}).encode(),
    ):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert "fr" in response["message"]


def test_reinstalling_the_same_id_updates_in_place_not_duplicates():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data",
        return_value=json.dumps({"id": "my-ext", "name": "First"}).encode(),
    ):
        json.loads(ExtensionsHandler().POST())
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data",
        return_value=json.dumps({"id": "my-ext", "name": "Second"}).encode(),
    ):
        json.loads(ExtensionsHandler().POST())
    assert len(state.extensions) == 1
    assert state.extensions[0]["name"] == "Second"


def test_an_id_with_invalid_characters_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch(
        "channel.web.api.extensions.web.data",
        return_value=json.dumps({"id": "Not Valid!", "name": "x"}).encode(),
    ):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"


# =====================================================================
# List / toggle / uninstall (admin-gated)
# =====================================================================

def test_list_returns_installed_extensions():
    state = _StoreState()
    state.extensions = [{"id": "a", "name": "A", "enabled": True}]
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5:
        response = json.loads(ExtensionsHandler().GET())
    assert response["extensions"] == [{"id": "a", "name": "A", "enabled": True}]


def test_toggle_flips_the_enabled_state():
    state = _StoreState()
    state.extensions = [{"id": "a", "name": "A", "enabled": True}]
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5:
        response = json.loads(ExtensionActionHandler().POST("a"))
    assert response["status"] == "success"
    assert state.extensions[0]["enabled"] is False


def test_toggle_on_an_unknown_id_returns_404():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5:
        response = json.loads(ExtensionActionHandler().POST("does-not-exist"))
    assert response["status"] == "error"
    assert web.ctx.status == "404 Not Found"


def test_delete_uninstalls_the_extension():
    state = _StoreState()
    state.extensions = [{"id": "a", "name": "A", "enabled": True}]
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5:
        response = json.loads(ExtensionActionHandler().DELETE("a"))
    assert response["status"] == "success"
    assert state.extensions == []


def test_delete_on_an_unknown_id_returns_404():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5:
        response = json.loads(ExtensionActionHandler().DELETE("does-not-exist"))
    assert response["status"] == "error"
    assert web.ctx.status == "404 Not Found"


def test_list_is_gated_on_the_extensions_capability():
    p1, p2, p3 = _denied_patches()
    with p1, p2, p3:
        with pytest.raises(web.HTTPError):
            ExtensionsHandler().GET()


def test_install_is_gated_on_the_extensions_capability():
    p1, p2, p3 = _denied_patches()
    with p1, p2, p3, patch(
        "channel.web.api.extensions.web.data", return_value=json.dumps({"name": "x"}).encode()
    ):
        with pytest.raises(web.HTTPError):
            ExtensionsHandler().POST()


# =====================================================================
# Active (auth-only, no admin capability needed)
# =====================================================================

def test_active_merges_css_and_strings_from_enabled_extensions_only():
    state = _StoreState()
    state.extensions = [
        {"id": "a", "enabled": True, "theme_css": ".a{}", "strings": {"en": {"k1": "v1"}}},
        {"id": "b", "enabled": False, "theme_css": ".b{}", "strings": {"en": {"k2": "v2"}}},
        {"id": "c", "enabled": True, "theme_css": ".c{}", "strings": {"ar": {"k3": "v3"}}},
    ]
    with patch("channel.web.api.extensions._require_auth"), \
         patch("channel.web.api.extensions.web.header"), \
         patch("channel.web.api.extensions._get_extensions", return_value=state.extensions):
        response = json.loads(ExtensionsActiveHandler().GET())
    assert ".a{}" in response["theme_css"]
    assert ".b{}" not in response["theme_css"]
    assert ".c{}" in response["theme_css"]
    assert response["strings"]["en"] == {"k1": "v1"}
    assert response["strings"]["ar"] == {"k3": "v3"}


def test_active_requires_authentication_but_not_admin_capability():
    with patch("channel.web.api.extensions._require_auth", side_effect=web.HTTPError(
        "401 Unauthorized", {}, "",
    )) as require_auth, \
         patch("channel.web.api.extensions.web.header"), \
         patch("channel.web.api.extensions._get_extensions", return_value=[]):
        with pytest.raises(web.HTTPError):
            ExtensionsActiveHandler().GET()
    require_auth.assert_called_once()


def test_active_with_no_extensions_returns_empty():
    with patch("channel.web.api.extensions._require_auth"), \
         patch("channel.web.api.extensions.web.header"), \
         patch("channel.web.api.extensions._get_extensions", return_value=[]):
        response = json.loads(ExtensionsActiveHandler().GET())
    assert response == {"status": "success", "theme_css": "", "strings": {}}


# =====================================================================
# tool_code: bounded, admin/owner + explicit risk_ack, real code execution
# (agent/tools/tool_manager.py's ToolManager.reload_extension_tools).
# =====================================================================

def test_tool_code_with_a_syntax_error_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "tool_code": "def broken(:", "risk_ack": True}
    with p1, p2, p3, p4, p5, patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert state.extensions == []


def test_oversized_tool_code_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "tool_code": "x = 1\n" * 10_000, "risk_ack": True}
    with p1, p2, p3, p4, p5, patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"


def test_tool_code_without_risk_ack_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "tool_code": "x = 1"}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role"), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert "risk" in response["message"].lower()
    assert state.extensions == []


def test_tool_code_with_risk_ack_installs_and_requires_admin_or_owner_role():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "tool_code": "x = 1", "risk_ack": True}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role") as role_check, \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "success"
    role_check.assert_called_once()
    assert state.extensions[0]["tool_code"] == "x = 1"


def test_tool_code_install_is_denied_for_a_non_admin_role():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)

    def _deny():
        raise web.HTTPError("403 Forbidden", {}, json.dumps({"status": "error"}))

    manifest = {"name": "x", "tool_code": "x = 1", "risk_ack": True}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role", side_effect=_deny), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        with pytest.raises(web.HTTPError):
            ExtensionsHandler().POST()
    assert state.extensions == []


def test_a_static_manifest_never_triggers_the_role_check():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "theme_css": ".a{}"}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role") as role_check, \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "success"
    role_check.assert_not_called()


def test_toggle_of_a_code_extension_requires_admin_or_owner_role():
    state = _StoreState()
    state.extensions = [{"id": "a", "name": "A", "enabled": True, "tool_code": "x = 1"}]
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch("channel.web.api.extensions._require_admin_or_owner_role") as role_check:
        response = json.loads(ExtensionActionHandler().POST("a"))
    assert response["status"] == "success"
    role_check.assert_called_once()


def test_delete_of_a_code_extension_requires_admin_or_owner_role():
    state = _StoreState()
    state.extensions = [{"id": "a", "name": "A", "enabled": True, "tool_code": "x = 1"}]
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    with p1, p2, p3, p4, p5, patch("channel.web.api.extensions._require_admin_or_owner_role") as role_check:
        response = json.loads(ExtensionActionHandler().DELETE("a"))
    assert response["status"] == "success"
    role_check.assert_called_once()


# =========================================================================
# channel_code / assistant_code / settings_page_js: the same admin/owner +
# risk_ack gate as tool_code, generalized across all four code fields.
# =========================================================================

def test_channel_code_with_a_syntax_error_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "channel_code": "def broken(:", "risk_ack": True}
    with p1, p2, p3, p4, p5, patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert state.extensions == []


def test_assistant_code_with_a_syntax_error_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "assistant_code": "def broken(:", "risk_ack": True}
    with p1, p2, p3, p4, p5, patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert state.extensions == []


def test_channel_code_without_risk_ack_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "channel_code": "x = 1"}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role"), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    assert state.extensions == []


def test_settings_page_js_alone_is_enough_to_require_risk_ack():
    """settings_page_js has no compile() check (it's JS, not Python) but
    still counts as code for the shared gate -- it runs with full page
    privileges in whoever opens it."""
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "settings_page_js": "alert(1)"}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role") as role_check, \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"
    role_check.assert_called_once()


def test_channel_code_with_risk_ack_installs_successfully():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "channel_code": "x = 1", "risk_ack": True}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role") as role_check, \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "success"
    role_check.assert_called_once()
    assert state.extensions[0]["channel_code"] == "x = 1"


def test_channel_fields_are_validated_and_cleaned():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {
        "name": "x", "channel_code": "x = 1", "risk_ack": True,
        "channel_label": "My Channel",
        "channel_fields": [{"key": "api_key", "label": "API Key", "type": "secret"}],
    }
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role"), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "success"
    assert state.extensions[0]["channel_label"] == "My Channel"
    assert state.extensions[0]["channel_fields"] == [{"key": "api_key", "label": "API Key", "type": "secret"}]


def test_a_channel_field_with_an_invalid_type_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {
        "name": "x", "channel_code": "x = 1", "risk_ack": True,
        "channel_fields": [{"key": "k", "label": "K", "type": "date"}],
    }
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role"), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"


def test_a_channel_field_missing_key_or_label_is_rejected():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {
        "name": "x", "channel_code": "x = 1", "risk_ack": True,
        "channel_fields": [{"type": "text"}],
    }
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role"), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "error"


def test_assistant_code_with_risk_ack_installs_successfully():
    state = _StoreState()
    p1, p2, p3 = _admin_patches()
    p4, p5 = _with_store(state)
    manifest = {"name": "x", "assistant_code": "def handle(q, c): return q", "risk_ack": True}
    with p1, p2, p3, p4, p5, \
         patch("channel.web.api.extensions._require_admin_or_owner_role"), \
         patch("channel.web.api.extensions.web.data", return_value=json.dumps(manifest).encode()):
        response = json.loads(ExtensionsHandler().POST())
    assert response["status"] == "success"
    assert state.extensions[0]["assistant_code"] == "def handle(q, c): return q"