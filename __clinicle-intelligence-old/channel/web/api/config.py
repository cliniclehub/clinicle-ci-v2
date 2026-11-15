"""The settings view's endpoint: /api/config.

Reads and writes the subset of config.json the console is allowed to touch
(EDITABLE_KEYS), masking API keys on the way out. The model catalogue this
page also renders is served by api/models.py.
"""

import json
import os

import web

from agent.permission import (
    MODES as PERMISSION_MODES,
    global_mode as permission_global_mode,
    normalize_mode as permission_normalize_mode,
)
from channel.web.api.connectors import _CONFIG_FILE_LOCK
from channel.web.core._common import (
    _desktop_token_matches,
    _is_loopback_request,
    _read_config_file_for_write,
    _require_auth,
    _require_capability,
)
from channel.web.core.providers import (
    PROVIDER_MODELS,
    legacy_custom_in_use,
    mask_key,
)
from common import i18n
from common.log import logger
from config import conf, get_data_root
from models.reasoning_capabilities import provider_reasoning_metadata


def _require_config_capability():
    """Settings > General and Settings > Security & Access both read/write
    through this one endpoint (model/agent config on one pane, web_password
    and agent_permission_mode on the other -- a known duplication flagged
    during the Settings consolidation, not yet split apart). Gating on
    "general" alone would 403 a member who only has "security" -- so this
    passes if the caller has either.

    config.json / channel_instances.py are instance-global with no owning
    org at all, unlike a normal per-org resource -- so a per-org capability
    grant alone is not enough here: an org's own settings.security/general
    capability could be handed to "member" (role_capabilities is
    per-org-configurable), which must never be enough to rotate API keys or
    flip agent_permission_mode for the WHOLE instance. This also requires
    the caller's own org-admin role (or above), the same
    role-not-just-capability gate extensions.py's
    _require_admin_or_owner_role() uses for this identical
    instance-global-resource pattern."""
    from agent.tenancy.store import get_tenancy_store

    store = get_tenancy_store()
    if not store.has_any_user():
        return
    from channel.web.core._common import _current_user_and_org

    user_id, org_id = _current_user_and_org()
    if user_id is None:
        _require_capability("settings.general")  # raises the standard 401
        return
    if not store.has_role(user_id, org_id, "admin"):
        raise web.HTTPError(
            "403 Forbidden", {"Content-Type": "application/json; charset=utf-8"},
            json.dumps({"status": "error", "message": "Only an org admin or owner can change instance settings"}),
        )
    if store.has_capability(user_id, org_id, "settings.general"):
        return
    _require_capability("settings.security")


class ConfigHandler:

    EDITABLE_KEYS = {
        "cow_lang",
        "model", "bot_type", "use_linkai",
        "open_ai_api_base", "deepseek_api_base", "qianfan_api_base", "claude_api_base", "gemini_api_base",
        "zhipu_ai_api_base", "moonshot_base_url", "ark_base_url", "custom_api_base", "mimo_api_base",
        "open_ai_api_key", "deepseek_api_key", "qianfan_api_key", "claude_api_key", "gemini_api_key",
        "zhipu_ai_api_key", "dashscope_api_key", "moonshot_api_key",
        "ark_api_key", "minimax_api_key", "linkai_api_key", "custom_api_key", "mimo_api_key",
        "custom_providers",
        "agent_max_context_tokens", "agent_max_context_turns", "agent_max_steps",
        "enable_thinking", "reasoning_effort", "reasoning_effort_by_model", "self_evolution_enabled", "web_password",
        "agent_permission_mode",
        "enable_cost_tracking", "watchdog_stall_threshold_seconds", "watchdog_max_nudges_per_session",
        "claude_code_cli_path", "claude_code_cli_cwd", "claude_code_cli_timeout_seconds",
        "codex_cli_path", "codex_cli_cwd", "codex_cli_timeout_seconds",
        "custom_css",
    }

    # Switches the API exposes flat - one key, one control - while the config
    # file keeps a feature's settings together under one object.
    NESTED_BOOLS = {
        "subagent_enabled": ("subagent", "enabled"),
    }

    # Same idea as NESTED_BOOLS, one level deeper: agent/tools/tool_manager.py
    # reads each tool's own config from config.json's top-level "tools" ->
    # <tool_name> object (see agent/tools/browser/browser_tool.py's own
    # docstring for what cdp_endpoint does -- attach to the user's own real
    # Chrome via CDP instead of launching a separate browser instance, so
    # its window IS the live view and a login-wall handoff is just the user
    # clicking into their own browser). A non-empty value turns CDP mode on;
    # blank falls back to the default persistent-profile launch.
    NESTED_TOOL_FIELDS = {
        "browser_cdp_endpoint": ("browser", "cdp_endpoint"),
    }

    def GET(self):
        _require_auth()
        _require_config_capability()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.subagent import SubagentSettings
            from agent.evolution.config import get_evolution_config

            local_config = conf()
            use_agent = local_config.get("agent", True)
            title = "Clinicle Intelligence" if use_agent else "AI Assistant"

            api_bases = {}
            api_keys_masked = {}
            for pid, pinfo in PROVIDER_MODELS.items():
                base_key = pinfo.get("api_base_key")
                if base_key:
                    api_bases[base_key] = local_config.get(base_key, pinfo["api_base_default"])
                key_field = pinfo.get("api_key_field")
                if key_field and key_field not in api_keys_masked:
                    raw = local_config.get(key_field, "")
                    api_keys_masked[key_field] = mask_key(raw) if raw else ""

            providers = {}
            provider_model = local_config.get("model", "")
            for pid, p in PROVIDER_MODELS.items():
                reasoning_by_model = {
                    model: provider_reasoning_metadata(pid, model)
                    for model in p["models"]
                }
                providers[pid] = {
                    "label": p["label"],
                    "models": p["models"],
                    "api_base_key": p["api_base_key"],
                    "api_base_default": p["api_base_default"],
                    "api_base_placeholder": p.get("api_base_placeholder", ""),
                    "api_key_field": p.get("api_key_field"),
                    "reasoning": provider_reasoning_metadata(pid, provider_model),
                    "reasoning_by_model": reasoning_by_model,
                }

            # Expose user-defined custom providers as "custom:<id>" entries so
            # the legacy config page can display and select them. Credentials
            # are managed on the Models page, hence the null key/base fields.
            # Mirrors the Models page: when expanded entries exist, the bare
            # legacy "custom" entry is hidden — unless the flat single-provider
            # custom config is still active or filled in.
            try:
                from models.custom_provider import get_custom_providers
                from models import model_catalog
                custom_list = get_custom_providers()
                keep_legacy_custom = legacy_custom_in_use(local_config)
                if custom_list and not keep_legacy_custom:
                    providers.pop("custom", None)
                catalog_map = model_catalog.get_catalog_map()
                for cp in custom_list:
                    cid = f"custom:{cp.get('id')}"
                    cname = cp.get("name") or cp.get("id")
                    # Same resolution /api/models uses for this same custom
                    # provider (ModelsHandler._custom_provider_cards): the
                    # full saved catalog when one exists, falling back to the
                    # provider's single `model` field -- so both endpoints
                    # report the same models instead of this one being stuck
                    # on a single-entry list.
                    catalog = catalog_map.get(cid) or []
                    models_list = (
                        [e["name"] for e in catalog] if catalog
                        else ([cp["model"]] if cp.get("model") else [])
                    )
                    providers[cid] = {
                        "label": {"ar": cname, "en": cname},
                        "models": models_list,
                        "api_base_key": None,
                        "api_base_default": None,
                        "api_base_placeholder": "",
                        "api_key_field": None,
                        "reasoning": provider_reasoning_metadata(cid, cp.get("model") or ""),
                        "reasoning_by_model": {
                            m: provider_reasoning_metadata(cid, m) for m in models_list
                        },
                    }
            except Exception as cp_err:
                logger.warning(f"[ConfigHandler] failed to expand custom providers: {cp_err}")

            raw_pwd = str(local_config.get("web_password", "") or "")
            masked_pwd = ("*" * len(raw_pwd)) if raw_pwd else ""

            result = {
                "status": "success",
                "use_agent": use_agent,
                "title": title,
                "model": local_config.get("model", ""),
                "bot_type": "openai" if local_config.get("bot_type") == "chatGPT" else local_config.get("bot_type", ""),
                "use_linkai": bool(local_config.get("use_linkai", False)),
                "channel_type": local_config.get("channel_type", ""),
                # Manual cap on the input budget (compact once reached); 0
                # disables the cap and follows the model window.
                "agent_max_context_tokens": local_config.get("agent_max_context_tokens", 64000),
                "agent_max_context_turns": local_config.get("agent_max_context_turns", 20),
                "agent_max_steps": local_config.get("agent_max_steps", 20),
                "enable_thinking": bool(local_config.get("enable_thinking", False)),
                "reasoning_effort": local_config.get("reasoning_effort", "high"),
                "reasoning_effort_by_model": local_config.get("reasoning_effort_by_model", {}),
                # Read through the feature's own loader so the default it
                # applies to an absent setting is the one shown here.
                "self_evolution_enabled": get_evolution_config().enabled,
                "subagent_enabled": SubagentSettings.from_config().enabled,
                # Read through the feature's own loader so a value this Settings
                # page never wrote (e.g. hand-edited into config.json) still
                # shows its real default here rather than an empty field.
                "enable_cost_tracking": bool(local_config.get("enable_cost_tracking", False)),
                "watchdog_stall_threshold_seconds": local_config.get("watchdog_stall_threshold_seconds", 900),
                "watchdog_max_nudges_per_session": local_config.get("watchdog_max_nudges_per_session", 2),
                "claude_code_cli_path": local_config.get("claude_code_cli_path", ""),
                "claude_code_cli_cwd": local_config.get("claude_code_cli_cwd", ""),
                "claude_code_cli_timeout_seconds": local_config.get("claude_code_cli_timeout_seconds", 300),
                "codex_cli_path": local_config.get("codex_cli_path", ""),
                "codex_cli_cwd": local_config.get("codex_cli_cwd", ""),
                "codex_cli_timeout_seconds": local_config.get("codex_cli_timeout_seconds", 300),
                "browser_cdp_endpoint": (local_config.get("tools", {}) or {}).get("browser", {}).get("cdp_endpoint", ""),
                "custom_css": local_config.get("custom_css", ""),
                # Default permission mode for sessions that have not pinned one.
                "agent_permission_mode": permission_global_mode(),
                "permission_modes": list(PERMISSION_MODES),
                "api_bases": api_bases,
                "api_keys": api_keys_masked,
                "providers": providers,
                "web_password_masked": masked_pwd,
            }
            # The desktop app runs on the local trusted machine, so it can edit
            # the real password in place (cursor at the end, delete to clear).
            # Browser access only ever sees the masked value. Gated per-request
            # on the loopback + per-launch-token check (same pattern as the
            # local-file-import route in channel/web/core/channel.py), not on
            # a process-wide env var -- COW_DESKTOP is set once for the whole
            # process, so it is not proof this particular request came from
            # the desktop shell.
            if _is_loopback_request() and _desktop_token_matches():
                result["web_password"] = raw_pwd
            return json.dumps(result, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error getting config: {e}")
            return json.dumps({"status": "error", "message": str(e)})

    def POST(self):
        _require_auth()
        _require_config_capability()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            data = json.loads(web.data())
            updates = data.get("updates", {})
            if not updates:
                return json.dumps({"status": "error", "message": "no updates provided"})

            local_config = conf()
            applied = {}
            nested = {}
            nested_tools = {}
            for key, value in updates.items():
                if key in self.NESTED_BOOLS:
                    section, leaf = self.NESTED_BOOLS[key]
                    nested.setdefault(section, {})[leaf] = bool(value)
                    continue
                if key in self.NESTED_TOOL_FIELDS:
                    tool_name, field = self.NESTED_TOOL_FIELDS[key]
                    nested_tools.setdefault(tool_name, {})[field] = str(value or "").strip()
                    continue
                if key not in self.EDITABLE_KEYS:
                    continue
                if key in (
                    "agent_max_context_tokens", "agent_max_context_turns", "agent_max_steps",
                    "watchdog_stall_threshold_seconds", "watchdog_max_nudges_per_session",
                    "claude_code_cli_timeout_seconds", "codex_cli_timeout_seconds",
                ):
                    value = int(value)
                if key in ("use_linkai", "enable_thinking", "self_evolution_enabled", "enable_cost_tracking"):
                    value = bool(value)
                # Never persist an unknown mode: every later read would silently
                # fall back and the UI would show a setting that does nothing.
                if key == "agent_permission_mode":
                    value = permission_normalize_mode(value)
                # A pasted stylesheet has no natural size limit from the
                # browser's own textarea -- cap it so one bad paste can't
                # bloat config.json indefinitely.
                if key == "custom_css":
                    value = str(value or "")
                    if len(value) > 50_000:
                        return json.dumps({
                            "status": "error",
                            "message": "custom_css must be 50,000 characters or fewer",
                        })
                # reasoning_effort_by_model is a dict that must be *merged* with
                # the persisted map, not replaced. A frontend submits only the
                # entries it changed (merged locally), so whole-key replacement
                # here would drop other models' saved efforts on a concurrent or
                # sequential save (or a second open settings page).
                if key == "reasoning_effort_by_model":
                    if not isinstance(value, dict):
                        # Reject malformed payloads explicitly instead of
                        # persisting a non-dict that the resolver would choke on.
                        return json.dumps({
                            "status": "error",
                            "message": "reasoning_effort_by_model must be a JSON object",
                        })
                    merged = dict(local_config.get("reasoning_effort_by_model") or {})
                    merged.update(value)
                    value = merged
                local_config[key] = value
                applied[key] = value

            if not applied and not nested and not nested_tools:
                return json.dumps({"status": "error", "message": "no valid keys to update"})

            config_path = os.path.join(get_data_root(), "config.json")
            # Locked for the whole read-modify-write: extensions.py and
            # connectors.py each do their own read-modify-write of this same
            # config.json with no coordination otherwise, so two concurrent
            # saves could each read a stale copy and one's write clobbers
            # the other's.
            with _CONFIG_FILE_LOCK:
                file_cfg = _read_config_file_for_write()
                # Capture old password before updating
                old_password = file_cfg.get("web_password", "") if "web_password" in applied else ""
                file_cfg.update(applied)
                # Merged rather than assigned: the UI sends the one switch it owns,
                # and the rest of the section is the user's to keep.
                for section, values in nested.items():
                    merged = dict(file_cfg.get(section) or {})
                    merged.update(values)
                    file_cfg[section] = merged
                    local_config[section] = merged
                    applied[section] = merged
                # One level deeper than `nested`: only this tool's own fields are
                # touched, so a hand-edited sibling field (persistent,
                # allow_private_targets, screenshot_dir, ...) under the same
                # tools.<tool_name> object is never dropped.
                for tool_name, values in nested_tools.items():
                    all_tools = dict(file_cfg.get("tools") or {})
                    tool_cfg = dict(all_tools.get(tool_name) or {})
                    tool_cfg.update(values)
                    all_tools[tool_name] = tool_cfg
                    file_cfg["tools"] = all_tools
                    local_config["tools"] = all_tools
                    applied["tools"] = all_tools
                with open(config_path, "w", encoding="utf-8") as f:
                    json.dump(file_cfg, f, indent=4, ensure_ascii=False)

            logger.info(f"[WebChannel] Config updated: {list(applied.keys())}")

            # Apply a language change immediately so backend logs, agent
            # replies and CLI output switch without a restart.
            if "cow_lang" in applied:
                try:
                    i18n.resolve_language(applied["cow_lang"])
                    logger.info(f"[WebChannel] Language switched to: {i18n.get_language()}")
                except Exception as lang_err:
                    logger.warning(f"[WebChannel] Failed to apply language: {lang_err}")

            # Check if password was cleared: if there was a password before clearing,
            # the service is likely bound to 0.0.0.0 (public), so warn the user.
            password_warning = None
            if "web_password" in applied:
                new_password = applied["web_password"]
                configured_host = file_cfg.get("web_host", "")
                
                # If password was cleared and there was a password before
                if not new_password and old_password:
                    # If web_host is not explicitly set, the service auto-binds based on password
                    # With password → 0.0.0.0 (public), without password → 127.0.0.1 (local)
                    # So clearing password when it was previously set means going from public to local
                    if not configured_host or configured_host == "0.0.0.0":
                        password_warning = "password_cleared_with_public_host"
                        logger.warning(
                            "[WebChannel] Password cleared while service is likely bound to 0.0.0.0. "
                            "Consider restarting the service to rebind to 127.0.0.1 "
                            "or explicitly set web_host in config to prevent unauthorized access."
                        )

            # Reset Bridge so that bot routing reflects the new config.
            # Without this, Bridge keeps its cached bot instance (e.g. LinkAIBot)
            # even after the user switches bot_type / use_linkai / model in UI.
            bridge_routing_keys = {"bot_type", "use_linkai", "model"}
            if any(k in applied for k in bridge_routing_keys):
                try:
                    from bridge.bridge import Bridge
                    Bridge().reset_bot()
                    logger.info("[WebChannel] Bridge bot routing reset due to config change")
                except Exception as reset_err:
                    logger.warning(f"[WebChannel] Failed to reset bridge: {reset_err}")

            # Evict cached agent runtimes when a config that is baked into the
            # Agent at construction time changes. These values (context budget,
            # turn/step caps) are read once in agent_initializer and cached on
            # the Agent instance, so without eviction an edit only takes effect
            # after a restart — the user changes the budget in the UI and sees
            # no change (the context-usage chart keeps the old limit). Clearing
            # the instances makes the next turn rebuild each agent from the new
            # config, no restart needed.
            agent_rebuild_keys = {
                "agent_max_context_tokens",
                "agent_max_context_turns",
                "agent_max_steps",
            }
            if any(k in applied for k in agent_rebuild_keys):
                try:
                    from bridge.bridge import Bridge
                    agent_bridge = Bridge().get_agent_bridge()
                    if agent_bridge is not None:
                        agent_bridge.clear_all_sessions()
                        logger.info(
                            "[WebChannel] Cleared cached agents so new "
                            f"{sorted(agent_rebuild_keys & applied.keys())} takes effect"
                        )
                except Exception as rebuild_err:
                    logger.warning(f"[WebChannel] Failed to clear agents: {rebuild_err}")

            return json.dumps({"status": "success", "applied": applied, "warning": password_warning}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error updating config: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class CustomCssHandler:
    """GET /api/custom-css -- {"custom_css": "..."}. Deliberately separate
    from ConfigHandler.GET: that endpoint requires settings.general/security
    (it returns API keys, masked but still gated to admins), while custom
    CSS is workspace-wide branding every logged-in member's page should
    apply, not just an admin's. Any authenticated user, any capability."""

    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps({"status": "success", "custom_css": conf().get("custom_css", "")}, ensure_ascii=False)
