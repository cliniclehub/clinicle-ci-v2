"""The agents view's endpoints: /api/agents and friends.

The Agent roster -- create, edit, delete -- their core files and their
avatars. Editing an Agent has to reach past the config file: the running
services hold a snapshot of the roster, so _reload_agent_runtime rebuilds
what changed, and _bind_channel_instance re-points the IM channels an Agent
answers on.
"""

from typing import Optional
import json
import os

import web

from channel.web.api.auth import _current_user_id
from channel.web.core._common import (
    _live_channel_manager,
    _raw_web_input,
    _read_uploaded_file_bytes,
    _require_auth,
)
from common.log import logger
from common.runtime_identity import current_identity
from config import conf, get_data_root


def _agent_admin_service():
    from agent.admin import AgentAdminService
    return AgentAdminService(os.path.join(get_data_root(), "config.json"))


def _org_id() -> str:
    return current_identity().org_id


def _has_role(user_id, org_id, min_role: str) -> bool:
    """Same shape as meetings.py's _is_org_admin: resolved against the
    RESOURCE's own org_id, always -- never the caller's ambient one. An
    earlier version of this file passed the caller's ambient org_id here,
    which meant an admin of ANY org would pass the check against an Agent
    belonging to a DIFFERENT org (a cross-org IDOR: exactly the "if-check
    after fetch is not a control" failure this repo's security standards
    warn about). The two only coincide when the caller happens to be looking
    at their own org's Agent, which is not something a permission check may
    assume."""
    if user_id is None or org_id is None:
        return False
    try:
        from agent.tenancy.store import get_tenancy_store
        return get_tenancy_store().has_role(int(user_id), int(org_id), min_role)
    except Exception as e:  # never let a role check crash the request
        logger.debug(f"[Agents] role check skipped: {e}")
        return False


def _is_org_admin(user_id, org_id) -> bool:
    return _has_role(user_id, org_id, "admin")


def _is_org_member(user_id, org_id) -> bool:
    """For the visible_to_org flag: any role counts (member is the lowest
    rank), unlike _is_org_admin."""
    return _has_role(user_id, org_id, "member")


def _load_agent_with_access(agent_id: str):
    """Returns (profile, user_id) on success, or a JSON 404 string on
    failure. An Agent that exists but the caller cannot use returns the SAME
    404 a nonexistent one would -- never 403 -- so a probe cannot distinguish
    "not shared with you" from "does not exist" (see A8 in this repo's
    security standards)."""
    from agent.registry import can_use_agent

    service = _agent_admin_service()
    try:
        profile = service._registry(service._load()).get(agent_id, require_enabled=False)
    except KeyError:
        profile = None
    if profile is None:
        web.ctx.status = "404 Not Found"
        return None, None, json.dumps({"status": "error", "message": "Not found"})
    user_id = _current_user_id()
    # Resolved against THIS Agent's own org_id -- see _has_role's docstring.
    is_admin = _is_org_admin(user_id, profile.org_id)
    is_member = _is_org_member(user_id, profile.org_id)
    if not can_use_agent(profile, user_id, is_admin, is_member):
        web.ctx.status = "404 Not Found"
        return None, None, json.dumps({"status": "error", "message": "Not found"})
    return profile, user_id, None


def _bind_channel_instance(channel_type: str, instance_id: str = "", agent_id: str = "", members=None):
    """Point one channel instance at an Agent (and team), hot-swapping without a restart.

    The binding lives on the channel instance itself (channel_instances[].agent_id
    in team.json), the single source of truth for routing. For a single-instance
    channel the instance id is just the channel type. An empty agent_id unbinds it
    (falls back to the default Agent).

    Rebinding only changes *which* Agent inbound messages route to — the
    credentials, connection, and scheduled tasks are untouched. Tasks live in
    the global store and carry their own ``agent_id``; flipping this picker
    must never migrate or rewrite them. We persist the new binding and then set
    ``bound_agent_id`` live on the running channel; the next inbound message
    reads the updated value. This avoids the reconnect storm a restart caused
    when the user flipped the picker a few times.
    """
    from channel.channel_instances import upsert_instance

    ctype = (channel_type or "").strip().lower()
    if not ctype:
        raise ValueError("channel_type is required")
    target_id = (instance_id or "").strip() or ctype
    agent_id = (agent_id or "").strip()

    inst = upsert_instance(
        conf(),
        channel_type=ctype,
        instance_id=target_id,
        agent_id=agent_id,
        members=members,
    )

    try:
        mgr = _live_channel_manager()
        channel = mgr.get_channel(target_id) if mgr else None
        if channel is not None:
            # Live-update owner + team on the running instance. Empty owner means
            # "follow the default Agent". No restart: this only changes routing.
            channel.bound_agent_id = agent_id
            channel.members = list(inst.members or [])
            # Kept in step with the record so a rebind does not leave the running
            # instance pointing at a stale way of reaching its teammates.
            channel.peers = [dict(p) for p in (inst.peers or [])]
            logger.info(
                f"[WebChannel] Channel '{target_id}' rebound to "
                f"'{agent_id or 'default'}' with team {inst.members or []} (no restart)"
            )
    except Exception as e:
        logger.error(
            f"[WebChannel] Failed to hot-rebind channel '{target_id}': {e}",
            exc_info=True,
        )

    return {
        "instance_id": inst.instance_id,
        "agent_id": inst.agent_id,
        "members": list(inst.members or []),
    }


def _reload_agent_runtime(service, changed_agent_ids=None) -> None:
    """Re-point the live runtime at a freshly loaded roster.

    This runs inside the roster-edit request, so it must stay cheap. The old
    implementation tore everything down - stop every scheduler, drop every
    cached session, then rebuild all of them - which grew linearly with the
    number of Agents (each rebuild reloads dozens of skills). Editing one
    Agent's name should not cost a full-fleet reload.

    Instead we reconcile incrementally:
      * swap the registry/router (always cheap),
      * start a scheduler only for Agents that gained one, stop those that
        disappeared, and leave already-running ones untouched,
      * evict only the sessions of the Agents that actually changed, so their
        next turn picks up the new name / model / persona. Everyone else keeps
        their warm cache.

    ``changed_agent_ids`` narrows the session eviction to just the edited
    Agents. When omitted we fall back to evicting nothing extra beyond the
    add/remove diff, since pure metadata edits without an id (e.g. binding
    changes) touch no cached runtime.
    """
    from agent.registry import set_agent_registry
    from agent.routing import AgentRouter, set_agent_router

    settings = service._load()
    registry = service._registry(settings)
    router = AgentRouter.from_config(settings, registry)
    set_agent_registry(registry)
    set_agent_router(router)

    from bridge.bridge import Bridge
    bridge = Bridge()
    agent_bridge = getattr(bridge, "_agent_bridge", None)
    if agent_bridge is None:
        return

    agent_bridge.agent_registry = registry
    agent_bridge.agent_router = router

    # Reconcile schedulers against what is already running, rather than
    # stopping and recreating the whole set.
    from agent.tools.scheduler.integration import init_scheduler, stop_scheduler
    live_ids = {p.id for p in registry.list(include_disabled=False)}
    previously = set(agent_bridge.scheduler_agent_ids)

    for agent_id in previously - live_ids:
        try:
            stop_scheduler(agent_id)
        except Exception as e:
            logger.warning(f"[WebChannel] stop_scheduler({agent_id}) failed: {e}")
        agent_bridge.scheduler_agent_ids.discard(agent_id)

    for profile in registry.list(include_disabled=False):
        if profile.id in previously:
            continue  # already has a running scheduler; init_scheduler is a no-op
        if init_scheduler(agent_bridge, profile.workspace, profile.id):
            agent_bridge.scheduler_agent_ids.add(profile.id)
    agent_bridge.scheduler_initialized = bool(agent_bridge.scheduler_agent_ids)

    # Drop cached runtimes only for the Agents whose definition changed, so the
    # edit takes effect on their next turn without wiping everyone's session.
    for agent_id in (changed_agent_ids or []):
        try:
            agent_bridge.clear_agent(agent_id)
        except Exception as e:
            logger.warning(f"[WebChannel] clear_agent({agent_id}) failed: {e}")


class AgentsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            service = _agent_admin_service()
            try:
                service.migrate_legacy_ownership()
            except Exception as e:  # never let a backfill break a page load
                logger.warning(f"[WebChannel] Ownership migration skipped: {e}")
            snapshot = _annotate_avatar_revs(service.snapshot())
            user_id = _current_user_id()
            from agent.registry import can_use_agent

            registry = service._registry(service._load())
            # Resolved per Agent against ITS OWN org_id, never a single value
            # computed against the caller's ambient org -- an admin of org X
            # must not pass the admin/member check against an org-Y Agent.
            # Cached per distinct org_id rather than re-querying per Agent,
            # since in practice every Agent on an instance shares one org.
            role_cache: dict = {}

            def roles_for(org_id):
                if org_id not in role_cache:
                    role_cache[org_id] = (
                        _is_org_admin(user_id, org_id),
                        _is_org_member(user_id, org_id),
                    )
                return role_cache[org_id]

            def visible(agent_dict):
                profile = registry.get(agent_dict.get("id"), require_enabled=False)
                is_admin, is_member = roles_for(profile.org_id)
                return can_use_agent(profile, user_id, is_admin, is_member)

            snapshot["agents"] = [a for a in snapshot.get("agents") or [] if visible(a)]
            return json.dumps({"status": "success", **snapshot}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Agents API error: {e}")
            return json.dumps({"status": "error", "message": str(e)})

    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data())
            action = body.get("action")
            service = _agent_admin_service()
            revision = body.get("revision") or None
            # Every action but "create" targets an existing Agent by "id" --
            # gate it through the same access check GET uses, and refuse (same
            # 404 shape, never 403) rather than let an owner-only action reach
            # an Agent the caller cannot even see existed. bind_channel_instance
            # is excluded: it addresses its target as "agent_id", not "id", and
            # is channel-routing config rather than an edit to the Agent itself.
            target_profile = None
            if action in ("update", "archive", "delete", "share", "set_knowledge_mode"):
                target_profile, err = _require_owner_or_admin(body.get("id", ""))
                if err:
                    return err
            if action == "create":
                user_id = _current_user_id()
                org_id = _org_id() if user_id is not None else None
                result = service.create_agent(
                    agent_id=body.get("id", ""),
                    name=body.get("name", ""),
                    # Blank means "put it where a new one goes", which is what
                    # the console sends: it asks for a name, not a path.
                    workspace=body.get("workspace") or None,
                    clone_from=body.get("clone_from") or None,
                    avatar=body.get("avatar") or None,
                    description=body.get("description") or None,
                    skills=body.get("skills"),
                    knowledge=body.get("knowledge"),
                    knowledge_mode=body.get("knowledge_mode") or None,
                    # Resolved server-side from the acting session, same rule
                    # every other tenancy-scoped write in this codebase
                    # follows -- never trust an owner/org from the request body.
                    owner_user_id=user_id,
                    org_id=org_id,
                    revision=revision,
                )
            elif action == "share":
                shared_with = body.get("shared_with")
                if not isinstance(shared_with, list):
                    return json.dumps({"status": "error", "message": "shared_with must be a list"})
                try:
                    shared_ids = [int(x) for x in shared_with]
                except (TypeError, ValueError):
                    return json.dumps({"status": "error", "message": "shared_with must be a list of user ids"})
                # Every id must actually be a member of THIS AGENT's org --
                # not the caller's ambient one (an admin's own org need not be
                # the Agent's) -- otherwise sharing would double as a way to
                # probe or grant access to an arbitrary user id from outside
                # the Agent's actual org.
                from agent.tenancy.store import get_tenancy_store
                agent_org_id = target_profile.org_id
                member_ids = set()
                if agent_org_id is not None:
                    member_ids = {m.user_id for m in get_tenancy_store().list_memberships_for_org(int(agent_org_id))}
                if any(uid not in member_ids for uid in shared_ids):
                    return json.dumps({"status": "error", "message": "shared_with must be members of the Agent's org"})
                result = service.share_agent(body.get("id", ""), shared_ids, revision=revision)
            elif action == "update":
                updates = {
                    "name": body.get("name"),
                    "enabled": body.get("enabled"),
                    "make_default": bool(body.get("make_default", False)),
                    "avatar": body.get("avatar"),
                    "description": body.get("description"),
                    "model": body.get("model"),
                    "bot_type": body.get("bot_type"),
                    "revision": revision,
                }
                if "skills" in body:
                    updates["skills"] = body.get("skills")
                if "knowledge" in body:
                    updates["knowledge"] = body.get("knowledge")
                if "require_approval_for_writes" in body:
                    updates["require_approval_for_writes"] = bool(body.get("require_approval_for_writes"))
                if "visible_to_org" in body:
                    updates["visible_to_org"] = bool(body.get("visible_to_org"))
                if "watchdog_stall_threshold_seconds" in body:
                    updates["watchdog_stall_threshold_seconds"] = body.get("watchdog_stall_threshold_seconds")
                if "watchdog_max_nudges" in body:
                    updates["watchdog_max_nudges"] = body.get("watchdog_max_nudges")
                if "watchdog_nudge_prompt" in body:
                    updates["watchdog_nudge_prompt"] = body.get("watchdog_nudge_prompt")
                if "custom_handler" in body:
                    updates["custom_handler"] = body.get("custom_handler")
                result = service.update_agent(body.get("id", ""), **updates)
            elif action == "archive":
                result = service.archive_agent(body.get("id", ""), revision=revision)
            elif action == "delete":
                result = service.delete_agent(body.get("id", ""), revision=revision)
            elif action == "set_knowledge_mode":
                # A filesystem toggle (symlink vs own dir), not a roster edit, so
                # it doesn't participate in the roster revision guard.
                result = service.set_knowledge_mode(
                    body.get("id", ""), body.get("mode", "")
                )
            elif action == "bind_channel_instance":
                # members: list => set team; omitted/None => leave team untouched
                raw_members = body.get("members", None)
                members = raw_members if isinstance(raw_members, list) else None
                result = _bind_channel_instance(
                    channel_type=body.get("channel_type", ""),
                    instance_id=body.get("instance_id", ""),
                    agent_id=body.get("agent_id", ""),
                    members=members,
                )
            else:
                return json.dumps({
                    "status": "error", "message": f"unknown action: {action}"
                })
            # Only the edited Agent needs its cached runtime dropped; a create
            # has no live sessions yet. bind_channel_instance hot-updates the
            # running channel's binding in place (see _bind_channel_instance),
            # so it neither restarts a channel nor touches the roster runtime.
            if action == "bind_channel_instance":
                return json.dumps(
                    {"status": "success", "result": result},
                    ensure_ascii=False,
                )
            changed = None
            if action in ("update", "archive", "delete", "set_knowledge_mode"):
                changed = [body.get("id", "")] if body.get("id") else None
            _reload_agent_runtime(service, changed_agent_ids=changed)
            # Hand back the fresh revision so a client making rapid successive
            # edits (e.g. ticking skill checkboxes) can chain them without a
            # full reload and without tripping the stale-roster guard.
            try:
                revision_after = service.snapshot().get("revision")
            except Exception:
                revision_after = None
            return json.dumps(
                {"status": "success", "result": result, "revision": revision_after},
                ensure_ascii=False,
            )
        except Exception as e:
            from agent.admin import StaleRosterError
            code = None
            if isinstance(e, StaleRosterError):
                web.ctx.status = "409 Conflict"
                code = "stale_roster"
            logger.error(f"[WebChannel] Agents POST error: {e}")
            return json.dumps({"status": "error", "message": str(e), "code": code})


def _require_owner_or_admin(agent_id: str):
    """AGENT.md/USER.md/RULE.md/MEMORY.md are the Agent's underlying config
    and persona, not something a merely-shared (use/chat-only, or org-wide
    visible) user should be able to read or edit -- only the owner or an org
    admin may. Returns (profile, None) on success, or (None, JSON 404 string)
    on failure (same not-found shape as everywhere else, never 403 -- see
    _load_agent_with_access). Callers that need the profile afterward (the
    "share" action validates targets against ITS org_id) get it back instead
    of looking it up a second time and risking the two diverging."""
    profile, user_id, err = _load_agent_with_access(agent_id)
    if err:
        return None, err
    # Resolved against THIS Agent's own org_id -- see _has_role's docstring.
    is_admin = _is_org_admin(user_id, profile.org_id)
    if profile.owner_user_id is not None and user_id != profile.owner_user_id and not is_admin:
        web.ctx.status = "404 Not Found"
        return None, json.dumps({"status": "error", "message": "Not found"})
    return profile, None


class AgentCoreFileHandler:
    def GET(self, agent_id: str, filename: str):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        _profile, err = _require_owner_or_admin(agent_id)
        if err:
            return err
        try:
            result = _agent_admin_service().read_core_file(agent_id, filename)
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})

    def PUT(self, agent_id: str, filename: str):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        _profile, err = _require_owner_or_admin(agent_id)
        if err:
            return err
        try:
            body = json.loads(web.data())
            result = _agent_admin_service().write_core_file(
                agent_id,
                filename,
                body.get("content"),
                body.get("revision", ""),
            )
            try:
                from bridge.bridge import Bridge
                agent_bridge = getattr(Bridge(), "_agent_bridge", None)
                if agent_bridge is not None:
                    agent_bridge.clear_agent(agent_id)
            except Exception as e:
                logger.warning(
                    f"[WebChannel] Failed to evict edited agent={agent_id}: {e}"
                )
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except Exception as e:
            from agent.admin import StaleAgentFileError
            if isinstance(e, StaleAgentFileError):
                web.ctx.status = "409 Conflict"
            return json.dumps({"status": "error", "message": str(e)})


# An emoji costs nothing to store or serve, so it is the default way to tell
# Agents apart; an uploaded picture sets the field to this token instead and the
# bytes live beside the other shared assets.
AVATAR_IMAGE_TOKEN = "image"
AVATAR_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
MAX_AVATAR_BYTES = 2 * 1024 * 1024


def _avatar_path(agent_id: str) -> Optional[str]:
    from common.runtime_identity import RuntimeIdentity
    from common.state_dir import shared_root

    # The agent roster itself is not org-scoped (_agent_admin_service() reads
    # a single global config.json, ignoring the ambient identity), so avatars
    # -- keyed by the same agent_id -- must resolve against that same global
    # root rather than shared_root()'s org-scoped default. Otherwise a signed-in
    # tenant session (which sets org_id on the ambient RuntimeIdentity for
    # every request) reads from an empty <workspace>/tenants/<org_id>/avatars
    # directory instead of the one avatars actually get uploaded to.
    base = shared_root(RuntimeIdentity()) / "avatars"
    for suffix in AVATAR_TYPES:
        candidate = base / f"{agent_id}{suffix}"
        if candidate.is_file():
            return str(candidate)
    return None


def _avatar_rev(agent_id: str) -> Optional[str]:
    """A cache-busting token derived from the avatar file's mtime.

    The roster revision only hashes team.json, but replacing an avatar rewrites
    an image file without touching any field there, so the revision stays put
    and the browser keeps serving the cached picture. Keying the URL on the
    file's mtime instead means every upload changes the token and the <img>
    refetches, even after a hard reload where in-memory hints are gone.
    """
    path = _avatar_path(agent_id)
    if not path:
        return None
    try:
        return str(int(os.path.getmtime(path)))
    except OSError:
        return None


def _annotate_avatar_revs(snapshot: dict) -> dict:
    """Attach ``avatar_rev`` to every Agent that carries an uploaded image."""
    for agent in snapshot.get("agents") or []:
        if agent.get("avatar") == AVATAR_IMAGE_TOKEN:
            rev = _avatar_rev(agent.get("id", ""))
            if rev:
                agent["avatar_rev"] = rev
    return snapshot


class AgentAvatarHandler:
    def GET(self, agent_id: str):
        _require_auth()
        path = _avatar_path(agent_id)
        if not path:
            web.ctx.status = "404 Not Found"
            web.header('Content-Type', 'application/json; charset=utf-8')
            return json.dumps({"status": "error", "message": "no avatar"})
        with open(path, "rb") as handle:
            data = handle.read()
        web.header('Content-Type', AVATAR_TYPES[os.path.splitext(path)[1].lower()])
        # Content-addressed by the caller via ?v=, so it can be cached hard.
        web.header('Cache-Control', 'private, max-age=86400')
        return data

    def POST(self, agent_id: str):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from common.runtime_identity import RuntimeIdentity
            from common.state_dir import shared_root
            from agent.registry import get_agent_registry

            get_agent_registry().get(agent_id, require_enabled=False)
            # Read the multipart body raw. web.input() decodes it as UTF-8, which
            # dies on the first non-text byte of an image (a PNG starts with the
            # byte 0x89) with "utf-8 codec can't decode byte 0x89". rawinput hands
            # back the bytes untouched, the same path the knowledge upload uses.
            params = _raw_web_input()
            upload = params.get("avatar")
            if upload is None:
                return json.dumps({"status": "error", "message": "avatar file required"})
            filename = getattr(upload, "filename", "") or ""
            raw = _read_uploaded_file_bytes(upload)
            if not raw:
                return json.dumps({"status": "error", "message": "avatar file required"})
            if len(raw) > MAX_AVATAR_BYTES:
                return json.dumps({"status": "error", "message": "avatar exceeds 2 MiB"})
            suffix = os.path.splitext(filename)[1].lower()
            if suffix not in AVATAR_TYPES:
                return json.dumps({
                    "status": "error",
                    "message": f"unsupported image type: {suffix or 'unknown'}",
                })

            # Same de-scoping as _avatar_path(): the agent roster this avatar
            # belongs to isn't org-scoped, so neither is its storage.
            base = shared_root(RuntimeIdentity()) / "avatars"
            base.mkdir(parents=True, exist_ok=True)
            # Drop any other extension first, so one Agent never ends up with
            # two avatar files and a resolution order deciding which one wins.
            for other in AVATAR_TYPES:
                stale = base / f"{agent_id}{other}"
                if other != suffix and stale.is_file():
                    try:
                        stale.unlink()
                    except OSError:
                        pass
            target = base / f"{agent_id}{suffix}"
            tmp = base / f".{agent_id}{suffix}.tmp"
            with open(tmp, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, target)

            service = _agent_admin_service()
            result = service.update_agent(agent_id, avatar=AVATAR_IMAGE_TOKEN)
            # An avatar is a file plus a metadata flag; it changes nothing about
            # routing, sessions or schedulers. Skipping the full runtime reload
            # keeps the upload instant instead of tearing everything down.
            # Hand back the fresh revision so the console can patch its roster in
            # place without a full reload and without going stale on the next edit.
            revision = service.snapshot().get("revision")
            return json.dumps(
                {"status": "success", "result": result, "revision": revision},
                ensure_ascii=False,
            )
        except Exception as e:
            logger.error(f"[WebChannel] Agent avatar upload error: {e}")
            return json.dumps({"status": "error", "message": str(e)})
