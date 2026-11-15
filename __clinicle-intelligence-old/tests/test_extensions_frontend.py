# encoding:utf-8
"""Frontend wiring for the Extensions system (channel/web/api/extensions.py):
Settings UI for install/list/toggle/uninstall, and the on-every-page-load
loader that applies an enabled extension's theme CSS and merges its
translation strings into the runtime I18N table."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def _config_js():
    return (ROOT / "channel/web/static/js/views/config.js").read_text(encoding="utf-8")


def _config_html():
    return (ROOT / "channel/web/templates/views/config.html").read_text(encoding="utf-8")


def _custom_css_js():
    return (ROOT / "channel/web/static/js/core/custom-css.js").read_text(encoding="utf-8")


def test_settings_has_an_extensions_card_and_install_modal():
    html = _config_html()
    assert 'id="cfg-extensions-list"' in html
    assert 'id="cfg-extensions-install-btn"' in html
    assert 'id="extension-install-modal-overlay"' in html
    assert 'id="extension-install-manifest"' in html


def test_config_js_wires_list_toggle_delete_and_install():
    js = _config_js()
    assert "function loadExtensionsList()" in js
    assert "fetch('/api/extensions')" in js
    assert "function toggleExtension(id)" in js
    assert "function deleteExtension(id)" in js
    assert "function installExtensionFromModal()" in js
    assert "loadExtensionsList()" in js  # called from loadConfigView


def test_extensions_list_loads_on_the_settings_page():
    js = _config_js()
    assert "loadExtensionsList();" in js


def test_toggle_and_delete_also_refresh_the_live_applied_styling():
    """Regression: an earlier version only refreshed the admin list on
    toggle/delete, leaving a just-disabled extension's CSS visibly still
    applied until a manual page reload -- caught by live verification."""
    js = _config_js()
    toggle_fn = js.split("function toggleExtension(id)")[1].split("function ")[0]
    delete_fn = js.split("function deleteExtension(id)")[1].split("function ")[0]
    assert "_ceRefreshActiveExtensionsIfLoaded()" in toggle_fn
    assert "_ceRefreshActiveExtensionsIfLoaded()" in delete_fn


def test_active_extensions_are_loaded_on_every_page():
    """Unlike the Settings-page-only list/install calls, this must fire
    unconditionally at script load time so every page (not just Settings)
    picks up an enabled extension's CSS/strings."""
    js = _custom_css_js()
    assert "loadActiveExtensions();" in js
    assert "fetch('/api/extensions/active')" in js


def test_extension_css_and_the_custom_css_field_use_separate_style_tags():
    """A user's own custom_css and an installed extension's theme_css must
    not clobber each other -- confirmed by each owning its own <style> id."""
    js = _custom_css_js()
    assert "cow-custom-css" in js
    assert "cow-extension-css" in js


def test_extension_strings_merge_without_overwriting_built_in_keys():
    js = _custom_css_js()
    assert "if (!(key in I18N[lang]))" in js


# =====================================================================
# tool_code: admin/owner + explicit risk_ack before a code-executing
# manifest is ever sent to the server (channel/web/api/extensions.py).
# =====================================================================

def test_a_manifest_with_tool_code_shows_a_confirmation_before_sending():
    js = _config_js()
    install_fn = js.split("function installExtensionFromModal()")[1].split("function ")[0]
    assert "manifest.tool_code" in install_fn
    assert "showConfirmModal(" in install_fn
    assert "manifest.risk_ack = true" in install_fn


def test_both_the_confirmed_and_static_paths_route_through_the_same_sender():
    """One call inside the risk_ack confirmation callback, one as the
    direct fallback for a plain (no tool_code) manifest -- both must reach
    the server the same way."""
    js = _config_js()
    install_fn = js.split("function installExtensionFromModal()")[1].split("function ")[0]
    assert install_fn.count("_ceSendInstall(manifest, statusEl)") == 2


def test_a_code_extension_shows_a_badge_in_the_admin_list():
    """The badge fires on any of the four code fields, not just tool_code --
    channel_code/assistant_code/settings_page_js are just as real."""
    js = _config_js()
    has_code_fn = js.split("function _ceExtensionHasCode(ext)")[1].split("function ")[0]
    assert "ext.tool_code" in has_code_fn
    assert "ext.channel_code" in has_code_fn
    assert "ext.assistant_code" in has_code_fn
    assert "ext.settings_page_js" in has_code_fn
    render_fn = js.split("function _ceRenderExtensionsList(extensions)")[1].split("function ")[0]
    assert "_ceExtensionHasCode(ext)" in render_fn
    assert "config_extensions_code_badge" in render_fn


def test_a_settings_page_extension_shows_an_open_button():
    js = _config_js()
    render_fn = js.split("function _ceRenderExtensionsList(extensions)")[1].split("function ")[0]
    assert "ext.settings_page_js" in render_fn
    assert "openExtensionSettingsPage" in render_fn


def test_opening_a_settings_page_injects_a_real_script_tag():
    js = _config_js()
    open_fn = js.split("function openExtensionSettingsPage(id)")[1].split("function ")[0]
    assert "createElement('script')" in open_fn
    assert "script.textContent = ext.settings_page_js" in open_fn
    html = _config_html()
    assert 'id="extension-settings-page-root"' in html
    assert 'id="extension-settings-page-overlay"' in html


def test_install_modal_treats_any_code_field_as_risky():
    js = _config_js()
    install_fn = js.split("function installExtensionFromModal()")[1].split("function ")[0]
    assert "manifest.channel_code" in install_fn
    assert "manifest.assistant_code" in install_fn
    assert "manifest.settings_page_js" in install_fn
