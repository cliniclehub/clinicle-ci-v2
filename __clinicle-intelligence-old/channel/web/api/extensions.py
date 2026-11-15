"""Extensions: /api/extensions/* -- a manifest-driven package system.
Static content (theme CSS + translation-string overrides) installs under
the plain admin gate below. A manifest that also carries any of the four
code fields below -- real Python/JS run with the app's full privileges,
no sandboxing or process isolation built for any of them (an explicit
scope decision, not an oversight; installing one is exactly as trusting as
installing an arbitrary server-side package) -- is a second, stricter
tier: org admin/owner role only (not just an admin-configurable
capability), and only with an explicit risk_ack on the request.

    tool_code           -- a BaseTool subclass, loaded through the same
                            directory scan agent/tools/tool_manager.py's
                            ToolManager already uses for on-disk tools.
    channel_code        -- a Channel subclass, registered into
                            channel/channel_factory.py so create_channel()
                            can build it; channel_label/channel_fields
                            (optional) make it appear in the Channels
                            settings page like a built-in channel.
    assistant_code      -- a module defining handle(query, context) -> str,
                            registered in agent/extensions/
                            assistant_registry.py. An Agent opts in by
                            setting its own custom_handler field to this
                            extension's id (see agent/registry.py's
                            AgentProfile) -- bridge/agent_bridge.py's
                            agent_reply() then answers that Agent's turns
                            with this function directly, bypassing the
                            normal LLM tool loop entirely.
    settings_page_js    -- raw JS rendered into a dedicated container when
                            an admin opens this extension's settings page
                            from the Extensions card.

Manifest shape (validated on install, see _validate_manifest):
    {
        "id": "my-extension",       # generated if omitted
        "name": "My Extension",     # required
        "version": "1.0.0",
        "author": "...",
        "description": "...",
        "theme_css": ".sidebar-item { ... }",
        "strings": {"en": {"key": "value"}, "ar": {"key": "قيمة"}},
        "tool_code": "class MyTool(BaseTool): ...",              # optional, admin/owner + risk_ack
        "channel_code": "class MyChannel(Channel): ...",         # optional, admin/owner + risk_ack
        "channel_label": "My Channel", "channel_fields": [...],  # optional, cosmetic only
        "assistant_code": "def handle(query, context): ...",     # optional, admin/owner + risk_ack
        "settings_page_js": "document.getElementById(...)..."    # optional, admin/owner + risk_ack
    }

Storage: config.json's top-level "extensions" list, same pattern as
custom_providers (models/custom_provider.py) -- a list of dicts, no
separate database. tool_code/channel_code/assistant_code additionally land
on disk as real .py files under get_data_root()/extension_{tools,
channels,assistants}/<id>.py so each domain's existing loader picks them
up; settings_page_js stays in config.json only, sent to the client on
request and executed there.
"""

from __future__ import annotations

import json
import re
import uuid

import web

from channel.web.core._common import _require_auth, _require_capability
from common.log import logger

_MAX_CSS_LEN = 50_000
_MAX_STRINGS_PER_LANG = 500
_MAX_STRING_LEN = 2_000
_MAX_CODE_LEN = 20_000
_ALLOWED_LANGS = {"en", "ar"}
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _require_extensions_capability():
    """Installing/removing a STATIC (no tool_code) extension is an admin
    action -- same settings.general/security gate as ConfigHandler's own
    _require_config_capability, duplicated here rather than imported to
    avoid a circular import between config.py and this module."""
    from agent.tenancy.store import get_tenancy_store

    store = get_tenancy_store()
    if not store.has_any_user():
        return
    from channel.web.core._common import _current_user_and_org

    user_id, org_id = _current_user_and_org()
    if user_id is None:
        _require_capability("settings.general")
        return
    if store.has_capability(user_id, org_id, "settings.general"):
        return
    _require_capability("settings.security")


def _require_admin_or_owner_role():
    """Stricter gate for a code-executing extension: an org's ROLE, not a
    per-org-configurable capability -- role_capabilities can grant
    settings.general to "member", which must never be enough to run
    arbitrary code in-process. No-op on a legacy single-password install,
    same fork point every other admin check in this codebase uses."""
    from agent.tenancy.store import get_tenancy_store

    store = get_tenancy_store()
    if not store.has_any_user():
        return
    from channel.web.core._common import _current_user_and_org

    user_id, org_id = _current_user_and_org()
    if user_id is None or not store.has_role(user_id, org_id, "admin"):
        raise web.HTTPError(
            "403 Forbidden", {"Content-Type": "application/json; charset=utf-8"},
            json.dumps({"status": "error", "message": "Only an org admin or owner can install a code-executing extension"}),
        )


def _extension_tools_dir():
    import os

    from config import get_data_root

    path = os.path.join(get_data_root(), "extension_tools")
    os.makedirs(path, exist_ok=True)
    return path


def _extension_tool_file_path(ext_id: str) -> str:
    import os

    return os.path.join(_extension_tools_dir(), f"{ext_id}.py")


def _sync_extension_tool_file(ext: dict) -> None:
    """Writes/removes this extension's on-disk tool file to match its
    current tool_code + enabled state, then asks every live ToolManager
    instance to pick up the change -- reload_extension_tools() to register
    a newly (re-)enabled tool, unregister_extension_tool() to actually drop
    a disabled/uninstalled one from an already-warm instance instead of
    leaving it callable until restart."""
    import os

    path = _extension_tool_file_path(ext["id"])
    from agent.tools.tool_manager import ToolManager

    if ext.get("tool_code") and ext.get("enabled", True):
        with open(path, "w", encoding="utf-8") as f:
            f.write(ext["tool_code"])
        for tm in ToolManager.instances():
            tm.reload_extension_tools()
    else:
        if os.path.exists(path):
            os.remove(path)
        for tm in ToolManager.instances():
            tm.unregister_extension_tool(ext["id"])


def _extension_channels_dir():
    import os

    from config import get_data_root

    path = os.path.join(get_data_root(), "extension_channels")
    os.makedirs(path, exist_ok=True)
    return path


def _extension_channel_file_path(ext_id: str) -> str:
    import os

    return os.path.join(_extension_channels_dir(), f"{ext_id}.py")


def _sync_extension_channel_file(ext: dict) -> None:
    """Writes/removes this extension's on-disk channel file to match its
    current channel_code + enabled state, then registers/unregisters it
    with channel/channel_factory.py and adds/removes its entry from the
    Channels settings page's channel type list so create_channel() and the
    admin UI both see it -- or stop seeing it -- immediately."""
    import os

    from channel import channel_factory

    path = _extension_channel_file_path(ext["id"])
    if ext.get("channel_code") and ext.get("enabled", True):
        with open(path, "w", encoding="utf-8") as f:
            f.write(ext["channel_code"])
        channel_factory.reload_extension_channels()
        _sync_extension_channel_def(ext, installed=True)
    else:
        if os.path.exists(path):
            os.remove(path)
        channel_factory.unregister_extension_channel(ext["id"])
        _sync_extension_channel_def(ext, installed=False)


def _sync_extension_channel_def(ext: dict, installed: bool) -> None:
    """Adds/removes this extension's entry in ChannelsHandler.CHANNEL_DEFS
    -- the same OrderedDict every built-in channel type is listed in --
    so the Channels settings page's existing generic add/save/connect flow
    (channel/web/api/channels.py) works for an extension channel with no
    changes to that flow at all."""
    from channel.web.api.channels import ChannelsHandler

    if installed:
        ChannelsHandler.CHANNEL_DEFS[ext["id"]] = {
            "label": ext.get("channel_label") or ext["name"],
            "icon": "fa-plug",
            "color": "indigo",
            "fields": ext.get("channel_fields") or [],
        }
    else:
        ChannelsHandler.CHANNEL_DEFS.pop(ext["id"], None)


def _extension_assistants_dir():
    import os

    from config import get_data_root

    path = os.path.join(get_data_root(), "extension_assistants")
    os.makedirs(path, exist_ok=True)
    return path


def _extension_assistant_file_path(ext_id: str) -> str:
    import os

    return os.path.join(_extension_assistants_dir(), f"{ext_id}.py")


def _sync_extension_assistant_file(ext: dict) -> None:
    """Writes/removes this extension's on-disk assistant file to match its
    current assistant_code + enabled state, then registers/unregisters its
    handle() function in agent/extensions/assistant_registry.py -- an
    Agent opts into it via its own custom_handler field, so disabling the
    extension here does not by itself change any Agent's config; it just
    makes that Agent's custom_handler reference dangle until re-enabled or
    the Agent is pointed elsewhere (bridge/agent_bridge.py's hook returns
    an error reply for a dangling reference, it never crashes)."""
    import os

    from agent.extensions import assistant_registry

    path = _extension_assistant_file_path(ext["id"])
    if ext.get("assistant_code") and ext.get("enabled", True):
        with open(path, "w", encoding="utf-8") as f:
            f.write(ext["assistant_code"])
        assistant_registry.reload_extension_assistants()
    else:
        if os.path.exists(path):
            os.remove(path)
        assistant_registry.unregister_assistant_handler(ext["id"])


def _sync_extension_code(ext: dict) -> None:
    """Runs every code-domain sync for one extension -- called on
    install/toggle/uninstall so all four possible code fields (tool_code,
    channel_code, assistant_code; settings_page_js needs no on-disk sync,
    it is served straight from config.json) land or clear together."""
    _sync_extension_tool_file(ext)
    _sync_extension_channel_file(ext)
    _sync_extension_assistant_file(ext)


def _get_extensions() -> list:
    from config import conf

    extensions = conf().get("extensions")
    return extensions if isinstance(extensions, list) else []


def _save_extensions(extensions: list) -> None:
    import os

    from channel.web.api.connectors import _CONFIG_FILE_LOCK
    from channel.web.core._common import _read_config_file_for_write
    from config import conf, get_data_root

    # Locked for the whole read-modify-write: config.py and connectors.py
    # each do their own read-modify-write of this same config.json with no
    # coordination otherwise.
    with _CONFIG_FILE_LOCK:
        conf()["extensions"] = extensions
        file_cfg = _read_config_file_for_write()
        file_cfg["extensions"] = extensions
        config_path = os.path.join(get_data_root(), "config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(file_cfg, f, indent=4, ensure_ascii=False)


def _validate_manifest(manifest: dict):
    """Returns (cleaned_manifest, None) or (None, error_message)."""
    if not isinstance(manifest, dict):
        return None, "Manifest must be a JSON object"

    name = str(manifest.get("name") or "").strip()
    if not name:
        return None, "'name' is required"
    if len(name) > 200:
        return None, "'name' must be 200 characters or fewer"

    ext_id = str(manifest.get("id") or "").strip().lower() or re.sub(r"[^a-z0-9-]", "-", name.lower())[:64].strip("-")
    if not ext_id or not _ID_RE.match(ext_id):
        return None, "'id' must be lowercase alphanumeric/hyphens, starting with a letter or digit"

    theme_css = str(manifest.get("theme_css") or "")
    if len(theme_css) > _MAX_CSS_LEN:
        return None, f"'theme_css' must be {_MAX_CSS_LEN} characters or fewer"

    strings = manifest.get("strings") or {}
    if not isinstance(strings, dict):
        return None, "'strings' must be an object keyed by language"
    cleaned_strings = {}
    for lang, entries in strings.items():
        if lang not in _ALLOWED_LANGS:
            return None, f"'strings' language {lang!r} not supported (must be 'en' or 'ar')"
        if not isinstance(entries, dict):
            return None, f"'strings.{lang}' must be an object"
        if len(entries) > _MAX_STRINGS_PER_LANG:
            return None, f"'strings.{lang}' has too many entries (max {_MAX_STRINGS_PER_LANG})"
        cleaned_entries = {}
        for key, value in entries.items():
            key = str(key)
            value = str(value)
            if len(value) > _MAX_STRING_LEN:
                return None, f"'strings.{lang}.{key}' must be {_MAX_STRING_LEN} characters or fewer"
            cleaned_entries[key] = value
        cleaned_strings[lang] = cleaned_entries

    def _validate_python_code(field_name, raw):
        code = str(raw or "")
        if len(code) > _MAX_CODE_LEN:
            return None, f"'{field_name}' must be {_MAX_CODE_LEN} characters or fewer"
        if code:
            try:
                compile(code, f"<extension:{ext_id}:{field_name}>", "exec")
            except SyntaxError as e:
                return None, f"'{field_name}' has a syntax error: {e}"
        return code, None

    tool_code, error = _validate_python_code("tool_code", manifest.get("tool_code"))
    if error:
        return None, error

    channel_code, error = _validate_python_code("channel_code", manifest.get("channel_code"))
    if error:
        return None, error

    assistant_code, error = _validate_python_code("assistant_code", manifest.get("assistant_code"))
    if error:
        return None, error

    settings_page_js = str(manifest.get("settings_page_js") or "")
    if len(settings_page_js) > _MAX_CODE_LEN:
        return None, f"'settings_page_js' must be {_MAX_CODE_LEN} characters or fewer"

    channel_label = str(manifest.get("channel_label") or "").strip()[:100]

    channel_fields_raw = manifest.get("channel_fields") or []
    if not isinstance(channel_fields_raw, list):
        return None, "'channel_fields' must be a list"
    cleaned_channel_fields = []
    for field in channel_fields_raw:
        if not isinstance(field, dict):
            return None, "'channel_fields' entries must be objects"
        field_key = str(field.get("key") or "").strip()
        field_label = str(field.get("label") or "").strip()
        field_type = str(field.get("type") or "text").strip()
        if not field_key or not field_label:
            return None, "'channel_fields' entries require 'key' and 'label'"
        if field_type not in ("text", "secret", "number", "bool"):
            return None, f"'channel_fields' entry type {field_type!r} must be 'text', 'secret', 'number', or 'bool'"
        cleaned_channel_fields.append({"key": field_key, "label": field_label, "type": field_type})

    return {
        "id": ext_id,
        "name": name,
        "version": str(manifest.get("version") or "").strip()[:50],
        "author": str(manifest.get("author") or "").strip()[:200],
        "description": str(manifest.get("description") or "").strip()[:1000],
        "theme_css": theme_css,
        "strings": cleaned_strings,
        "tool_code": tool_code,
        "channel_code": channel_code,
        "channel_label": channel_label,
        "channel_fields": cleaned_channel_fields,
        "assistant_code": assistant_code,
        "settings_page_js": settings_page_js,
        "enabled": True,
    }, None


def _has_any_code(cleaned: dict) -> bool:
    """True if this manifest carries any of the four code-executing
    fields -- the shared trigger for the stricter admin/owner + risk_ack
    gate, regardless of which one(s) are present."""
    return bool(
        cleaned.get("tool_code") or cleaned.get("channel_code")
        or cleaned.get("assistant_code") or cleaned.get("settings_page_js")
    )


class ExtensionsHandler:
    """GET: list installed extensions (admin). POST: install one from a
    pasted manifest (admin)."""

    def GET(self):
        _require_auth()
        _require_extensions_capability()
        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps({"status": "success", "extensions": _get_extensions()}, ensure_ascii=False)

    def POST(self):
        _require_auth()
        _require_extensions_capability()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid JSON"}, ensure_ascii=False)

        manifest = body.get("manifest") if isinstance(body.get("manifest"), dict) else body
        cleaned, error = _validate_manifest(manifest)
        if error:
            return json.dumps({"status": "error", "message": error}, ensure_ascii=False)

        if _has_any_code(cleaned):
            _require_admin_or_owner_role()
            if body.get("risk_ack") is not True:
                return json.dumps({
                    "status": "error",
                    "message": "This extension includes executable code that runs with full server privileges. Confirm the risk acknowledgment to install it.",
                }, ensure_ascii=False)

        extensions = _get_extensions()
        if any(e.get("id") == cleaned["id"] for e in extensions):
            # Re-installing the same id updates it in place rather than
            # duplicating -- the id is the identity, not the list position.
            extensions = [cleaned if e.get("id") == cleaned["id"] else e for e in extensions]
        else:
            extensions.append(cleaned)

        _save_extensions(extensions)
        _sync_extension_code(cleaned)
        logger.info(f"[Extensions] Installed '{cleaned['id']}' ({cleaned['name']})" + (" [code]" if _has_any_code(cleaned) else ""))
        return json.dumps({"status": "success", "extension": cleaned}, ensure_ascii=False)


class ExtensionActionHandler:
    """POST /api/extensions/<id> -- flip enabled state (admin).
    DELETE /api/extensions/<id> -- uninstall (admin)."""

    def POST(self, ext_id):
        _require_auth()
        _require_extensions_capability()
        web.header('Content-Type', 'application/json; charset=utf-8')
        extensions = _get_extensions()
        toggled = None
        for ext in extensions:
            if ext.get("id") == ext_id:
                ext["enabled"] = not ext.get("enabled", True)
                toggled = ext
                break
        if toggled is None:
            web.ctx.status = "404 Not Found"
            return json.dumps({"status": "error", "message": "Extension not found"}, ensure_ascii=False)
        if _has_any_code(toggled):
            _require_admin_or_owner_role()
        _save_extensions(extensions)
        _sync_extension_code(toggled)
        return json.dumps({"status": "success", "extensions": extensions}, ensure_ascii=False)

    def DELETE(self, ext_id):
        _require_auth()
        _require_extensions_capability()
        web.header('Content-Type', 'application/json; charset=utf-8')
        extensions = _get_extensions()
        removed = next((e for e in extensions if e.get("id") == ext_id), None)
        if removed is None:
            web.ctx.status = "404 Not Found"
            return json.dumps({"status": "error", "message": "Extension not found"}, ensure_ascii=False)
        if _has_any_code(removed):
            _require_admin_or_owner_role()
        remaining = [e for e in extensions if e.get("id") != ext_id]
        _save_extensions(remaining)
        _sync_extension_code({**removed, "enabled": False})
        logger.info(f"[Extensions] Uninstalled '{ext_id}'")
        return json.dumps({"status": "success"}, ensure_ascii=False)


class ExtensionsActiveHandler:
    """GET /api/extensions/active -- merged theme_css + strings from every
    ENABLED extension. Auth-only, no settings capability required: this is
    what every logged-in member's page applies on load, the same reasoning
    as CustomCssHandler's own split from the admin-gated /config."""

    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        css_parts = []
        strings: dict = {}
        for ext in _get_extensions():
            if not ext.get("enabled", True):
                continue
            if ext.get("theme_css"):
                css_parts.append(ext["theme_css"])
            for lang, entries in (ext.get("strings") or {}).items():
                strings.setdefault(lang, {}).update(entries)
        return json.dumps({
            "status": "success",
            "theme_css": "\n".join(css_parts),
            "strings": strings,
        }, ensure_ascii=False)
