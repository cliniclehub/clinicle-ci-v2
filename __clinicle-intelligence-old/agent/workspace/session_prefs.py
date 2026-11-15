"""Per-session runtime preferences: which model answers, what it may change.

Sibling of :mod:`agent.workspace.project_store`, same shape and same key scheme.
A conversation can pin its own model and its own permission mode; anything not
pinned follows the global settings, so an untouched session keeps behaving the
way the instance is configured.

Why a JSON file rather than the sessions table: the web UI mints a session id in
the browser and a row only appears once the first message is persisted. A user
who picks a model before typing must have somewhere to put it, and this store
has no foreign key to satisfy.

Stored under ``<shared_root>/session_prefs.json``::

    {
      "sessions": {
        "default::session_abc": {
          "provider": "claudeAPI",
          "model": "claude-sonnet-5",
          "permission": "workspace-write",
          "ts": 1731999999.0
        }
      }
    }

Every field is optional. Absent means "follow the global setting".
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Dict, Optional

from common.log import logger

# Model/provider/permission stay in this file's own JSON, for the reason the
# module doc gives — set before a conversation has a first message. `members`
# (the roster of Agents invited into this conversation) used to live here
# too, but now delegates to agent.workspace.team_store as a "shared" team
# (see that module's shared-session-teams section): one store for every kind
# of multi-Agent grouping instead of two. get_prefs/set_prefs below still
# read and write a "members" key exactly as before -- every caller in the
# codebase goes through this module, never the old JSON shape directly, so
# nothing downstream of here needed to change. A session whose old row still
# carries `members` from before this change is migrated into team_store the
# first time it is read (see get_prefs), transparent to the caller.
_FIELDS = ("provider", "model", "permission")

_lock = threading.Lock()


def _store_file() -> str:
    from common.state_dir import shared_root

    return str(shared_root() / "session_prefs.json")


def _load() -> Dict:
    path = _store_file()
    if not os.path.isfile(path):
        return {"sessions": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except Exception as e:
        logger.warning(f"[SessionPrefs] Could not read {path}: {e}")
        return {"sessions": {}}
    if not isinstance(data.get("sessions"), dict):
        data["sessions"] = {}
    return data


def _save(data: Dict) -> None:
    path = _store_file()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception as e:
        logger.warning(f"[SessionPrefs] Could not write {path}: {e}")


def _session_key(session_id: str, agent_id: Optional[str]) -> str:
    """Namespace by agent so identical session ids across Agents don't collide."""
    return f"{agent_id or 'default'}::{session_id}"


def _migrate_legacy_members(session_id: str, agent_id: Optional[str], entry: Dict) -> None:
    """One-time upgrade: a row saved before this module delegated `members`
    to team_store still carries the old field. Move it over and strip it from
    the local row, so this only ever runs once per session."""
    from agent.workspace import team_store

    legacy = entry.get("members")
    if not legacy:
        return
    team_store.set_shared_members(agent_id, session_id, list(legacy))
    with _lock:
        data = _load()
        key = _session_key(session_id, agent_id)
        fresh = data["sessions"].get(key)
        if isinstance(fresh, dict) and fresh.get("members"):
            fresh = {k: v for k, v in fresh.items() if k != "members"}
            if any(fresh.get(f) for f in _FIELDS):
                data["sessions"][key] = fresh
            else:
                data["sessions"].pop(key, None)
            _save(data)


def get_prefs(session_id: str, agent_id: Optional[str] = None) -> Dict:
    """Overrides explicitly set for a session (missing keys = follow global).

    ``members`` -- who else is invited into this conversation -- is not
    stored in this file; it is read from team_store's shared-session teams
    (see that module) and merged in here so every caller sees the same shape
    it always has.
    """
    if not session_id:
        return {}
    with _lock:
        data = _load()
        entry = data["sessions"].get(_session_key(session_id, agent_id))
    result = {k: entry[k] for k in _FIELDS if isinstance(entry, dict) and entry.get(k)}

    if isinstance(entry, dict) and entry.get("members"):
        _migrate_legacy_members(session_id, agent_id, entry)

    from agent.workspace import team_store
    members = team_store.get_shared_members(agent_id, session_id)
    if members:
        result["members"] = members
    return result


def members_index() -> Dict[tuple, list]:
    """Every team conversation's roster, keyed by ``(agent_id, session_id)``.

    Listing conversations needs the roster for a whole page at once, and asking
    per row would re-read and re-parse the file once per conversation. Only
    team conversations appear here, so an empty result means nobody has ever
    invited anybody. Delegates to team_store's shared-session teams -- see
    get_prefs's docstring for why `members` lives there now.
    """
    from agent.workspace import team_store

    return team_store.shared_members_index()


def set_prefs(
    session_id: str,
    agent_id: Optional[str] = None,
    **updates,
) -> Dict:
    """Merge overrides for a session; pass ``None`` for a field to clear it.

    Returns the resulting override dict (empty when the session now follows the
    global settings entirely). ``members``, if passed, goes to team_store
    instead of this file -- see get_prefs's docstring.
    """
    if not session_id:
        raise ValueError("session_id is required")

    members_touched = "members" in updates
    members_value = updates.pop("members", None)

    key = _session_key(session_id, agent_id)
    with _lock:
        data = _load()
        entry = data["sessions"].get(key)
        entry = dict(entry) if isinstance(entry, dict) else {}

        for field in _FIELDS:
            if field not in updates:
                continue
            value = updates[field]
            if value is None or (isinstance(value, str) and not value.strip()):
                entry.pop(field, None)
            else:
                entry[field] = value.strip() if isinstance(value, str) else value

        result = {k: entry[k] for k in _FIELDS if entry.get(k)}
        if result:
            data["sessions"][key] = {**result, "ts": time.time()}
        else:
            # Nothing pinned any more: drop the row instead of leaving a husk.
            data["sessions"].pop(key, None)
        _save(data)

    from agent.workspace import team_store
    if members_touched:
        members = team_store.set_shared_members(agent_id, session_id, members_value)
    else:
        members = team_store.get_shared_members(agent_id, session_id)
    if members:
        result["members"] = members
    return result


def forget_session(session_id: str, agent_id: Optional[str] = None) -> None:
    """Drop a session's overrides (called when the conversation is deleted)."""
    if not session_id:
        return
    key = _session_key(session_id, agent_id)
    with _lock:
        data = _load()
        if data["sessions"].pop(key, None) is not None:
            _save(data)


def forget_agent(agent_id: str) -> None:
    """Erase every trace of a deleted Agent from the prefs store.

    Deleting an Agent leaves a dangling reference here that would otherwise
    linger forever: its own sessions' overrides, keyed ``{agent_id}::*`` —
    orphaned, because the conversations they belonged to were removed with
    the Agent's workspace. Its ``members`` rosters (its own shared
    conversations, and its id as a ghost teammate in others') are pruned the
    same way from team_store — see get_prefs's docstring for why that field
    lives there now.
    """
    if not agent_id:
        return

    from agent.workspace import team_store
    team_store.forget_agent_from_shared_teams(agent_id)

    owner_prefix = f"{agent_id}::"
    with _lock:
        data = _load()
        sessions = data["sessions"]
        changed = False
        for key in [k for k in sessions if str(k).startswith(owner_prefix)]:
            sessions.pop(key, None)
            changed = True
        if changed:
            _save(data)


def resolve_permission(session_id: str, agent_id: Optional[str] = None) -> str:
    """The permission mode in force for a session: its own, else the global one."""
    from agent.permission import global_mode, normalize_mode

    prefs = get_prefs(session_id, agent_id)
    if prefs.get("permission"):
        return normalize_mode(prefs["permission"], global_mode())
    return global_mode()
