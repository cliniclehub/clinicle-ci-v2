"""Agent profile registry.

The registry is deliberately small: an agent is identified by a stable ID and
one complete Clinicle Intelligence workspace. Runtime, routing, and persistence layers build
on this module without changing the existing single-agent configuration path.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from common.utils import expand_path


_AGENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

# Id of the built-in single agent, and the reserved alias by which the default
# agent can always be addressed (see AgentRegistry.get_addressed).
DEFAULT_AGENT_ALIAS = "default"


class AgentRegistryError(ValueError):
    """Raised when agent configuration is invalid."""


def can_use_agent(
    profile: "AgentProfile",
    user_id: Optional[int],
    is_org_admin: bool,
    is_org_member: bool = False,
) -> bool:
    """Per-Agent ACL -- same shape as agent/workspace/meeting_store.py's
    can_view(), deliberately: owner and org admins always have access, an
    explicitly shared user_id gains it too, an Agent marked visible_to_org
    grants it to any member of that same org, everyone else does not.

    ``user_id`` is None on a legacy no-account install (or when the caller
    could not resolve a session at all) -- there is no per-user identity to
    restrict anything to anywhere else in the app, so this returns True
    unconditionally rather than locking every Agent out from under a
    single-shared-password deployment that predates accounts entirely.

    An Agent with no owner_user_id is one that existed before this field, or
    one created outside any org (see the "assign existing Agents to their
    org's owner" migration in agent/admin.py) -- unrestricted, exactly
    today's behavior, never silently private.

    ``is_org_member`` is deliberately a separate flag from ``is_org_admin``
    (never derived from it) -- the caller must resolve it against this
    Agent's OWN org_id, the same IDOR-avoidance rule _is_org_admin already
    documents in channel/web/api/agents.py, not the caller's ambient org."""
    if user_id is None or profile.owner_user_id is None:
        return True
    if is_org_admin:
        return True
    if profile.owner_user_id == user_id:
        return True
    if profile.visible_to_org and is_org_member:
        return True
    return user_id in profile.shared_with


@dataclass(frozen=True)
class AgentProfile:
    """Configuration for one complete Clinicle Intelligence workspace."""

    id: str
    name: str
    workspace: str
    #: What this Agent is for, in one line. Read by teammates: a name alone is
    #: enough to address someone but not to decide whose work something is.
    description: Optional[str] = None
    enabled: bool = True
    model: Optional[str] = None
    bot_type: Optional[str] = None
    avatar: Optional[str] = None
    # Which shared assets this Agent draws on. ``None`` means "all of them",
    # which is what every existing config means and what a new Agent gets;
    # an empty tuple is a real answer that differs from it, so the two cannot
    # collapse into one falsy case.
    skills: Optional[Tuple[str, ...]] = None
    knowledge: Optional[Tuple[str, ...]] = None
    # Opt-in approval gate (agent/permission/execution_gate.py): when True,
    # this Agent's edit/write calls are staged for a human Accept/Reject
    # instead of executing immediately. False for every Agent that predates
    # this field (and every Agent that never sets it), so the shared
    # _execute_tool choke point stays behaviorally unchanged by default.
    require_approval_for_writes: bool = False
    # Per-agent overrides for the stall watchdog (agent/tools/scheduler/
    # integration.py's _execute_stall_watchdog). None means "use the
    # watchdog task's own / global default" -- these only narrow the window
    # for one agent, they never enable the watchdog by themselves.
    watchdog_stall_threshold_seconds: Optional[int] = None
    watchdog_max_nudges: Optional[int] = None
    # Custom nudge message for this Agent specifically -- formatted with the
    # same {minutes} placeholder as the built-in _NUDGE_PROMPT. None means
    # "use that default text", same fallback shape as the two fields above.
    watchdog_nudge_prompt: Optional[str] = None
    # Opt-in override to an admin-installed extension assistant handler
    # (channel/web/api/extensions.py's assistant_code field, registry in
    # agent/extensions/assistant_registry.py) -- names an extension id whose
    # handle(query, context) function answers this Agent's turns directly,
    # bypassing the normal LLM tool loop entirely. None (every existing
    # Agent, and every new one by default) means "use the normal loop" --
    # see bridge/agent_bridge.py's agent_reply for the actual branch point.
    custom_handler: Optional[str] = None
    # Sharing (see agent/workspace/meeting_store.py's can_view for the ACL
    # this mirrors): owner_user_id/org_id are None for a legacy no-account
    # install and for every Agent that predates this field -- unrestricted,
    # exactly today's behavior. Once set, only the owner, an admin of org_id,
    # or a user_id listed in shared_with may use the Agent; see
    # channel/web/api/agents.py's can_use_agent().
    owner_user_id: Optional[int] = None
    org_id: Optional[str] = None
    shared_with: Tuple[int, ...] = ()
    # Coarser than shared_with: every member of org_id gets access, not just
    # the ones named. False by default even once owner_user_id is set --
    # opt-in broadening, never the other way around. Independent of
    # shared_with (both can be set; either being true is enough).
    visible_to_org: bool = False

    @property
    def workspace_path(self) -> Path:
        return Path(self.workspace)

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "workspace": self.workspace,
            "enabled": self.enabled,
        }
        if self.description:
            data["description"] = self.description
        if self.model:
            data["model"] = self.model
        if self.bot_type:
            data["bot_type"] = self.bot_type
        if self.avatar:
            data["avatar"] = self.avatar
        if self.skills is not None:
            data["skills"] = list(self.skills)
        if self.knowledge is not None:
            data["knowledge"] = list(self.knowledge)
        if self.require_approval_for_writes:
            data["require_approval_for_writes"] = True
        if self.watchdog_stall_threshold_seconds is not None:
            data["watchdog_stall_threshold_seconds"] = self.watchdog_stall_threshold_seconds
        if self.watchdog_max_nudges is not None:
            data["watchdog_max_nudges"] = self.watchdog_max_nudges
        if self.watchdog_nudge_prompt is not None:
            data["watchdog_nudge_prompt"] = self.watchdog_nudge_prompt
        if self.custom_handler is not None:
            data["custom_handler"] = self.custom_handler
        if self.owner_user_id is not None:
            data["owner_user_id"] = self.owner_user_id
        if self.org_id is not None:
            data["org_id"] = self.org_id
        if self.shared_with:
            data["shared_with"] = list(self.shared_with)
        if self.visible_to_org:
            data["visible_to_org"] = True
        return data


def _normalise_workspace(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentRegistryError("agent workspace must be a non-empty string")
    return str(Path(expand_path(value.strip())).resolve(strict=False))


def _asset_selection(
    raw: Mapping[str, Any], agent_id: str, key: str
) -> Optional[Tuple[str, ...]]:
    """Parse an "only these shared assets" list, keeping absent distinct from empty.

    Absent means this Agent draws on everything, which is what every config
    written before the field existed means. A list, including an empty one,
    means the selection is deliberate.
    """
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise AgentRegistryError(
            f"agent '{agent_id}' {key} must be a list of strings when set"
        )
    seen = []
    for name in value:
        name = name.strip()
        if name and name not in seen:
            seen.append(name)
    return tuple(seen)


def _profile_from_mapping(
    raw: Mapping[str, Any], default_workspace: Optional[str] = None
) -> AgentProfile:
    """Build one profile. ``default_workspace`` fills in an omitted workspace.

    Omitting it is the common case: what a second Agent needs is a persona and
    a name, and the shared skills, knowledge and credentials it reads live at
    the instance root either way. Spelling out a path per Agent is only worth
    it when one of them has to sit somewhere else, such as another disk.

    An empty string stays an error. Absent means "put it wherever you'd put a
    new one"; empty means the caller tried to say something and failed.
    """
    agent_id = raw.get("id")
    if not isinstance(agent_id, str) or not _AGENT_ID_RE.fullmatch(agent_id):
        raise AgentRegistryError(
            "agent id must be 1-64 URL-safe characters: letters, numbers, _ or -"
        )

    name = raw.get("name", agent_id)
    if not isinstance(name, str) or not name.strip():
        raise AgentRegistryError(f"agent '{agent_id}' name must be a non-empty string")

    enabled = raw.get("enabled", True)
    if not isinstance(enabled, bool):
        raise AgentRegistryError(f"agent '{agent_id}' enabled must be a boolean")

    description = raw.get("description")
    if description is not None and not isinstance(description, str):
        raise AgentRegistryError(f"agent '{agent_id}' description must be a string")

    model = raw.get("model")
    bot_type = raw.get("bot_type")
    for key, value in (("model", model), ("bot_type", bot_type)):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise AgentRegistryError(
                f"agent '{agent_id}' {key} must be a non-empty string when set"
            )

    workspace = raw.get("workspace")
    if workspace is None:
        workspace = default_workspace

    avatar = raw.get("avatar")
    if avatar is not None and not isinstance(avatar, str):
        raise AgentRegistryError(f"agent '{agent_id}' avatar must be a string")

    require_approval_for_writes = raw.get("require_approval_for_writes", False)
    if not isinstance(require_approval_for_writes, bool):
        raise AgentRegistryError(
            f"agent '{agent_id}' require_approval_for_writes must be a boolean"
        )

    watchdog_stall_threshold_seconds = raw.get("watchdog_stall_threshold_seconds")
    if watchdog_stall_threshold_seconds is not None and (
        not isinstance(watchdog_stall_threshold_seconds, int)
        or isinstance(watchdog_stall_threshold_seconds, bool)
        or watchdog_stall_threshold_seconds <= 0
    ):
        raise AgentRegistryError(
            f"agent '{agent_id}' watchdog_stall_threshold_seconds must be a positive integer"
        )

    watchdog_max_nudges = raw.get("watchdog_max_nudges")
    if watchdog_max_nudges is not None and (
        not isinstance(watchdog_max_nudges, int)
        or isinstance(watchdog_max_nudges, bool)
        or watchdog_max_nudges <= 0
    ):
        raise AgentRegistryError(
            f"agent '{agent_id}' watchdog_max_nudges must be a positive integer"
        )

    watchdog_nudge_prompt = raw.get("watchdog_nudge_prompt")
    if watchdog_nudge_prompt is not None:
        if not isinstance(watchdog_nudge_prompt, str):
            raise AgentRegistryError(f"agent '{agent_id}' watchdog_nudge_prompt must be a string")
        watchdog_nudge_prompt = watchdog_nudge_prompt.strip() or None
        if watchdog_nudge_prompt and len(watchdog_nudge_prompt) > 2000:
            raise AgentRegistryError(
                f"agent '{agent_id}' watchdog_nudge_prompt must be 2000 characters or fewer"
            )

    owner_user_id = raw.get("owner_user_id")
    if owner_user_id is not None and (
        isinstance(owner_user_id, bool) or not isinstance(owner_user_id, int)
    ):
        raise AgentRegistryError(f"agent '{agent_id}' owner_user_id must be an integer")

    org_id = raw.get("org_id")
    if org_id is not None and not isinstance(org_id, str):
        raise AgentRegistryError(f"agent '{agent_id}' org_id must be a string")

    shared_with_raw = raw.get("shared_with")
    shared_with: Tuple[int, ...] = ()
    if shared_with_raw is not None:
        if not isinstance(shared_with_raw, list) or not all(
            isinstance(x, int) and not isinstance(x, bool) for x in shared_with_raw
        ):
            raise AgentRegistryError(f"agent '{agent_id}' shared_with must be a list of integers")
        seen_ids = []
        for uid in shared_with_raw:
            if uid not in seen_ids:
                seen_ids.append(uid)
        shared_with = tuple(seen_ids)

    visible_to_org = raw.get("visible_to_org", False)
    if not isinstance(visible_to_org, bool):
        raise AgentRegistryError(f"agent '{agent_id}' visible_to_org must be a boolean")

    custom_handler = raw.get("custom_handler")
    if custom_handler is not None:
        if not isinstance(custom_handler, str):
            raise AgentRegistryError(f"agent '{agent_id}' custom_handler must be a string")
        custom_handler = custom_handler.strip() or None

    return AgentProfile(
        id=agent_id,
        name=name.strip(),
        workspace=_normalise_workspace(workspace),
        description=(description.strip() or None) if description else None,
        enabled=enabled,
        model=model.strip() if isinstance(model, str) else None,
        bot_type=bot_type.strip() if isinstance(bot_type, str) else None,
        avatar=avatar.strip() if isinstance(avatar, str) and avatar.strip() else None,
        skills=_asset_selection(raw, agent_id, "skills"),
        knowledge=_asset_selection(raw, agent_id, "knowledge"),
        require_approval_for_writes=require_approval_for_writes,
        watchdog_stall_threshold_seconds=watchdog_stall_threshold_seconds,
        watchdog_max_nudges=watchdog_max_nudges,
        watchdog_nudge_prompt=watchdog_nudge_prompt,
        owner_user_id=owner_user_id,
        org_id=org_id.strip() if isinstance(org_id, str) and org_id.strip() else None,
        shared_with=shared_with,
        visible_to_org=visible_to_org,
        custom_handler=custom_handler,
    )


class AgentRegistry:
    """Thread-safe registry of configured agent workspaces."""

    def __init__(self, profiles: Iterable[AgentProfile], default_agent_id: str):
        self._lock = threading.RLock()
        self._profiles: Dict[str, AgentProfile] = {}
        self._default_agent_id = default_agent_id

        workspaces: Dict[str, str] = {}
        for profile in profiles:
            if profile.id in self._profiles:
                raise AgentRegistryError(f"duplicate agent id: {profile.id}")
            owner = workspaces.get(profile.workspace)
            if owner is not None:
                raise AgentRegistryError(
                    f"agents '{owner}' and '{profile.id}' share workspace "
                    f"'{profile.workspace}'"
                )
            self._profiles[profile.id] = profile
            workspaces[profile.workspace] = profile.id

        if not self._profiles:
            raise AgentRegistryError("at least one agent profile is required")
        self._validate_default(default_agent_id)

    @classmethod
    def from_config(cls, settings: Mapping[str, Any]) -> "AgentRegistry":
        instance_root = _normalise_workspace(settings.get("agent_workspace") or "~/cow")

        raw_agents = settings.get("agents")
        if raw_agents is None or raw_agents == []:
            # Single-agent install: the sole agent owns the instance root. Its id
            # is normally the built-in "default", but a provisioner may inject one
            # so the id is stable and meaningful from first boot; an invalid or
            # absent value falls back to "default" and never breaks startup.
            builtin_id = settings.get("default_agent_id")
            # A value injected via env may arrive as a non-string (e.g. an
            # all-digit id parsed as int), so coerce before validating.
            builtin_id = str(builtin_id).strip() if builtin_id is not None else ""
            if not builtin_id or not _AGENT_ID_RE.match(builtin_id):
                builtin_id = DEFAULT_AGENT_ALIAS
            builtin_name = settings.get("default_agent_name")
            builtin_name = str(builtin_name).strip() if builtin_name is not None else ""
            builtin_desc = settings.get("default_agent_description")
            builtin_desc = str(builtin_desc).strip() if builtin_desc is not None else ""
            profile = AgentProfile(
                id=builtin_id,
                name=builtin_name or "Clinicle Intelligence",
                description=builtin_desc,
                workspace=instance_root,
            )
            return cls([profile], builtin_id)

        if not isinstance(raw_agents, list):
            raise AgentRegistryError("agents must be a list")
        for index, raw in enumerate(raw_agents):
            if not isinstance(raw, Mapping):
                raise AgentRegistryError(f"agents[{index}] must be an object")

        # Which entry inherits the instance root has to be settled before the
        # profiles are built, so the default is read off the raw list. An
        # explicit default that does not resolve is a configuration error and
        # must fail loudly, in _validate_default. An absent one falls back to
        # the first agent so that adding a second workspace does not require a
        # second setting.
        default_agent_id = settings.get("default_agent_id") or ""
        if not isinstance(default_agent_id, str):
            raise AgentRegistryError("default_agent_id must be a string")
        default_agent_id = default_agent_id.strip()
        if not default_agent_id:
            default_agent_id = next(
                (
                    str(raw.get("id"))
                    for raw in raw_agents
                    if raw.get("enabled", True) is True
                ),
                str(raw_agents[0].get("id")),
            )

        # The default Agent inherits the instance root, which is where a
        # single-Agent install already keeps everything: hand-writing an
        # `agents` list around an existing workspace must not silently relocate
        # it. Every other Agent lands under `agents/<id>/`.
        root = Path(instance_root)
        profiles: List[AgentProfile] = [
            _profile_from_mapping(
                raw,
                default_workspace=(
                    instance_root
                    if raw.get("id") == default_agent_id
                    else str(root / "agents" / str(raw.get("id") or ""))
                ),
            )
            for raw in raw_agents
        ]
        return cls(profiles, default_agent_id)

    @property
    def default_agent_id(self) -> str:
        with self._lock:
            return self._default_agent_id

    def _validate_default(self, agent_id: str) -> None:
        profile = self._profiles.get(agent_id)
        if profile is None:
            raise AgentRegistryError(f"default agent '{agent_id}' is not configured")
        if not profile.enabled:
            raise AgentRegistryError(f"default agent '{agent_id}' is disabled")

    def get(self, agent_id: Optional[str] = None, require_enabled: bool = True) -> AgentProfile:
        with self._lock:
            resolved_id = agent_id or self._default_agent_id
            profile = self._profiles.get(resolved_id)
            if profile is None:
                raise KeyError(resolved_id)
            if require_enabled and not profile.enabled:
                raise AgentRegistryError(f"agent '{resolved_id}' is disabled")
            return profile

    def get_addressed(self, agent_id: Optional[str], require_enabled: bool = True) -> AgentProfile:
        """The agent an inbound request addresses by id.

        Like ``get``, except that the reserved id ``"default"`` always means
        the default agent, whatever id it was actually given. Remote callers
        can therefore address the default agent without knowing its real id.
        Any other unknown id still raises, so a request is never silently
        answered by a different agent.
        """
        requested = (agent_id or "").strip()
        if requested == DEFAULT_AGENT_ALIAS:
            requested = ""
        return self.get(requested or None, require_enabled=require_enabled)

    def get_or_default(self, agent_id: Optional[str]) -> AgentProfile:
        with self._lock:
            profile = self._profiles.get(agent_id) if agent_id else None
            if profile is not None and profile.enabled:
                return profile
            return self._profiles[self._default_agent_id]

    def list(self, include_disabled: bool = True) -> List[AgentProfile]:
        with self._lock:
            profiles = list(self._profiles.values())
            if not include_disabled:
                profiles = [profile for profile in profiles if profile.enabled]
            return sorted(profiles, key=lambda profile: profile.id)

    def upsert(self, profile: AgentProfile) -> None:
        with self._lock:
            for existing in self._profiles.values():
                if existing.id != profile.id and existing.workspace == profile.workspace:
                    raise AgentRegistryError(
                        f"agents '{existing.id}' and '{profile.id}' share workspace "
                        f"'{profile.workspace}'"
                    )
            self._profiles[profile.id] = profile
            self._validate_default(self._default_agent_id)

    def set_enabled(self, agent_id: str, enabled: bool) -> AgentProfile:
        with self._lock:
            current = self.get(agent_id, require_enabled=False)
            if agent_id == self._default_agent_id and not enabled:
                raise AgentRegistryError("the default agent cannot be disabled")
            updated = replace(current, enabled=enabled)
            self._profiles[agent_id] = updated
            return updated

    def set_default(self, agent_id: str) -> None:
        with self._lock:
            profile = self.get(agent_id, require_enabled=True)
            self._default_agent_id = profile.id

    def remove(self, agent_id: str) -> AgentProfile:
        with self._lock:
            if agent_id == self._default_agent_id:
                raise AgentRegistryError("the default agent cannot be removed")
            try:
                return self._profiles.pop(agent_id)
            except KeyError:
                raise KeyError(agent_id) from None


_registry_instance: Optional[AgentRegistry] = None
_registry_signature: Optional[tuple] = None
_registry_pinned: bool = False
_registry_lock = threading.Lock()

# Per-org registries, keyed by (org_id, signature) — separate from the single
# no-org-id instance above so a tenant lookup can never touch, invalidate, or
# be served by the default single-tenant cache. See the tenancy plan at
# ~/.claude/plans/typed-pondering-owl.md: each org gets its own AgentRegistry
# rooted under its own directory tree, the same "workspace root = tenant
# boundary" pattern ToolManager already uses for its own per-workspace cache.
_org_registry_instances: Dict[tuple, AgentRegistry] = {}


def _config_signature(settings: Mapping[str, Any]) -> tuple:
    from agent import team

    return (team.stamp(settings), settings.get("agent_workspace") or "")


def _org_instance_root(settings: Mapping[str, Any], org_id: str) -> str:
    """Where one org's agents live: <platform default root>/tenants/<org_id>.

    Deliberately independent of whatever `agent_workspace` is set to for the
    no-org-id path — an org's data must never land under the same directory
    two different org_ids could also resolve to.
    """
    base = _normalise_workspace(settings.get("agent_workspace") or "~/cow")
    return str(Path(base) / "tenants" / org_id)


def get_agent_registry(org_id: Optional[str] = None) -> AgentRegistry:
    """Return the process-wide registry for the current configuration.

    Keyed on the settings it was built from rather than cached outright:
    resolving a workspace happens on hot paths, but config can still change
    under us - the console edits it, tests mutate it, and anything that
    resolved a path before load_config() saw the pre-config value.

    ``org_id`` selects the per-tenant cache instead of the single default
    instance below — a completely separate dict, so passing it can never
    affect, invalidate, or be served by the no-org-id path, and omitting it
    (the overwhelming majority of call sites, today all of them) behaves
    exactly as before this parameter existed.
    """

    global _registry_instance, _registry_signature
    import os

    from agent import team
    from config import conf

    settings = conf()
    signature = _config_signature(settings)

    if org_id is not None:
        key = (org_id, signature)
        with _registry_lock:
            cached = _org_registry_instances.get(key)
            if cached is not None:
                return cached
            org_settings = dict(team.resolve(settings))
            org_settings["agent_workspace"] = _org_instance_root(settings, org_id)
            registry = AgentRegistry.from_config(org_settings)
            _org_registry_instances[key] = registry
            return registry

    with _registry_lock:
        if _registry_pinned and _registry_instance is not None:
            return _registry_instance
        if _registry_instance is None or _registry_signature != signature:
            # The roster is its own file; config.json only still holds it on an
            # install that has not written one yet. `resolve` hides which.
            settings = team.resolve(settings)
            try:
                _registry_instance = AgentRegistry.from_config(settings)
            except AgentRegistryError:
                # An invalid `agents`/`default_agent_id` block would otherwise
                # bubble all the way up through load_config() and take the whole
                # process down before the web console can bind — leaving a
                # desktop user with no UI to fix the very config that is broken.
                # Fall back to the default single agent so the app still starts;
                # the console can then edit the bad block. Source deployments
                # keep failing loudly so the developer sees the error at once.
                if os.environ.get("COW_DESKTOP") != "1":
                    raise
                from common.log import logger

                logger.error(
                    "[AgentRegistry] invalid 'agents' config; ignoring it and "
                    "starting with the default agent. Fix it in the console.",
                    exc_info=True,
                )
                fallback = {
                    k: v
                    for k, v in dict(settings).items()
                    if k not in ("agents", "default_agent_id")
                }
                _registry_instance = AgentRegistry.from_config(fallback)
            _registry_signature = signature
        return _registry_instance


def set_agent_registry(registry: Optional[AgentRegistry]) -> None:
    """Pin a registry, or pass None to go back to following configuration.

    A pinned registry survives config changes, which is what admin mutations
    (upsert, set_enabled) and tests need.
    """

    global _registry_instance, _registry_signature, _registry_pinned
    with _registry_lock:
        _registry_instance = registry
        _registry_signature = None
        _registry_pinned = registry is not None
