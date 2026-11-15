"""Team roster store: named groups of Agents that share a team workspace.

Ported from AionUi's team model (see their `team-runtime-experience` PRD) onto
Clinicle Intelligence's actual stack. The core idea carries over unchanged: a team is a
named roster of *slots* — one per member instance, so the same Agent can be
invited twice and still get two independent conversations. Exactly one slot
has ``role == "leader"``, always first, never removable.

What does NOT carry over: AionUi spins up a separate OS-level runtime process
per slot with its own warmup/health telemetry (SQLite-backed, Electron IPC).
Clinicle Intelligence has no per-agent runtime process to warm up — every Agent already
answers over the same conversation store this instance already runs. So here
"a slot" is just "an Agent id plus a freshly minted session id it owns" —
no warmup phase is needed because there is nothing to spin up.

Stored under ``<shared_root>/teams.json``::

    {
      "teams": {
        "team_abc": {
          "id": "team_abc",
          "name": "prodectivety",
          "created_at": 1730000000.0,
          "updated_at": 1730000000.0,
          "workspace": "/Users/hania/projects/launch-plan",
          "members": [
            {"slot_id": "slot_1", "agent_id": "leader-agent", "role": "leader",
             "session_id": "session_xyz"},
            {"slot_id": "slot_2", "agent_id": "writer-agent", "role": "teammate",
             "session_id": "session_abc"}
          ]
        }
      }
    }

Each member's ``session_id`` is a normal "web" channel session for that Agent
— it shows up in that Agent's own conversation store exactly like any other
session, so nothing else in the app needs to know teams exist.

``workspace`` (optional) mirrors AionUi's shared team workspace: when set,
every member's session is bound to that directory via
``agent.workspace.project_store.set_project_dir`` — the same binding an
ordinary session gets from the composer's project picker, so a team's
sessions get the usual project badge in the sidebar and `@`-reference the
same files for free, no separate concept for the rest of the app to know
about. A member added later inherits the team's workspace automatically.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from typing import Dict, List, Optional

from common.log import logger

_lock = threading.Lock()


def _store_file() -> str:
    from common.state_dir import shared_root
    return str(shared_root() / "teams.json")


def _load() -> Dict:
    path = _store_file()
    if not os.path.isfile(path):
        return {"teams": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except Exception as e:
        logger.warning(f"[TeamStore] Could not read {path}: {e}")
        return {"teams": {}}
    if not isinstance(data.get("teams"), dict):
        data["teams"] = {}
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
        logger.warning(f"[TeamStore] Could not write {path}: {e}")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def list_teams() -> List[Dict]:
    with _lock:
        data = _load()
    teams = list(data["teams"].values())
    teams.sort(key=lambda t: t.get("updated_at", 0), reverse=True)
    return teams


def get_team(team_id: str) -> Optional[Dict]:
    with _lock:
        data = _load()
    return data["teams"].get(team_id)


def list_teams_for_org(org_id: int) -> List[Dict]:
    """Teams tagged with this org -- the Org Graph view's read side. A team
    created before the Org Graph feature (or on a legacy no-account install)
    has no ``org_id`` key at all, hence ``.get`` rather than a plain lookup;
    it simply never matches a real org_id and is excluded, same as one
    explicitly set to None would be."""
    return [t for t in list_teams() if t.get("org_id") == org_id]


def set_team_org(team_id: str, org_id: Optional[int]) -> Optional[Dict]:
    """Tags (or untags, with ``org_id=None``) one team with an org. Callers
    must already have resolved ``org_id`` from the acting user's own
    membership (see ``channel/web/api/org_graph.py``) -- this never accepts
    one from a request body directly, so an admin can only ever link a team
    into their OWN org, never move it into someone else's."""
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if team is None:
            return None
        team["org_id"] = org_id
        team["updated_at"] = time.time()
        _save(data)
        return team


# In-memory only -- mirrors AionUi's ITeamSlotWork.state (idle/running), just
# without the queued/starting/paused states their separate runtime processes
# need. A delegate call is a single blocking hop on this process, so "running"
# only needs to exist between _delegate's mark and its finally-clause clear.
_slot_work: Dict[str, Dict[str, float]] = {}


def mark_slot_running(team_id: str, slot_id: str) -> None:
    _slot_work.setdefault(team_id, {})[slot_id] = time.time()


def mark_slot_idle(team_id: str, slot_id: str) -> None:
    _slot_work.get(team_id, {}).pop(slot_id, None)


def get_slot_work(team_id: str) -> Dict[str, float]:
    """slot_id -> started_at (epoch seconds) for every slot currently mid-delegate."""
    return dict(_slot_work.get(team_id, {}))


# =====================================================================
# Task board -- ported from AionUi's team_task_create/dependency model
# (confirmed live: the Leader creates one task per teammate with an
# owner and a blocked_by list, dispatches unblocked tasks, and waits
# for a dependency to finish before dispatching what it blocks).
#
# Columns are backlog/todo/in_progress/review/done (the web Task Board's
# Kanban columns -- see channel/web/api/task_board.py). A task with unmet
# blockers starts in "backlog" instead of a separate "blocked" status/column;
# ``blocked_by`` is still there for the frontend to show a lock icon and for
# Autopilot (agent/tools/team/autopilot.py) to know it isn't dispatchable yet.
# =====================================================================

TASK_STATUSES = ("backlog", "todo", "in_progress", "review", "done")


def create_task(team_id: str, subject: str, owner: Optional[str] = None,
                 blocked_by: Optional[List[str]] = None) -> Dict:
    """owner is a slot_id; blocked_by is a list of other task ids in this team."""
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if team is None:
            raise ValueError(f"Team '{team_id}' not found")
        task = {
            "id": _new_id("task"),
            "subject": subject,
            "owner": owner,
            "status": "backlog" if blocked_by else "todo",
            "blocked_by": list(blocked_by or []),
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        team.setdefault("tasks", []).append(task)
        team["updated_at"] = time.time()
        _save(data)
        return task


def list_tasks(team_id: str) -> List[Dict]:
    with _lock:
        data = _load()
    team = data["teams"].get(team_id)
    return list(team.get("tasks", [])) if team else []


def list_all_tasks() -> List[Dict]:
    """Every task across every team, for the fleet-wide Task Board -- each
    annotated with its team's id/name and its owner slot's agent_id so the
    board can render a card without a second round trip per team."""
    with _lock:
        data = _load()
    tasks: List[Dict] = []
    for team in data["teams"].values():
        owners = {m["slot_id"]: m["agent_id"] for m in team.get("members", [])}
        for task in team.get("tasks", []):
            enriched = dict(task)
            enriched["team_id"] = team["id"]
            enriched["team_name"] = team["name"]
            enriched["owner_agent_id"] = owners.get(task.get("owner"))
            tasks.append(enriched)
    return tasks


def update_task(team_id: str, task_id: str, **fields) -> Dict:
    """Merge arbitrary fields into one task -- the general form Autopilot uses
    to record a result/verify note alongside a status change in one write.
    ``status``, if given, is validated the same as ``update_task_status``."""
    status = fields.get("status")
    if status is not None and status not in TASK_STATUSES:
        raise ValueError(f"Invalid status: {status}")
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if team is None:
            raise ValueError(f"Team '{team_id}' not found")
        task = next((t for t in team.get("tasks", []) if t["id"] == task_id), None)
        if task is None:
            raise ValueError(f"Task '{task_id}' not found")
        task.update(fields)
        task["updated_at"] = time.time()
        team["updated_at"] = time.time()
        _save(data)
        return task


def update_task_status(team_id: str, task_id: str, status: str) -> Dict:
    return update_task(team_id, task_id, status=status)


def set_autopilot(team_id: str, enabled: bool) -> Dict:
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if team is None:
            raise ValueError(f"Team '{team_id}' not found")
        team["autopilot"] = bool(enabled)
        team["updated_at"] = time.time()
        _save(data)
        return team


def is_autopilot_enabled(team_id: str) -> bool:
    with _lock:
        data = _load()
    team = data["teams"].get(team_id)
    return bool(team and team.get("autopilot"))


def _bind_workspace(agent_id: str, session_id: str, workspace: str) -> str:
    """Binds one member's session to the workspace, returning the normalized
    absolute path `set_project_dir` resolved it to. Propagates
    FileNotFoundError for a bad path -- the caller must not persist a team
    whose workspace only half-bound to its members."""
    from agent.workspace import project_store
    return project_store.set_project_dir(session_id, workspace, agent_id)


def create_team(name: str, members: List[Dict], workspace: Optional[str] = None,
                 org_id: Optional[int] = None) -> Dict:
    """``members`` is ``[{"agent_id": ..., "role": "leader" | "teammate"}, ...]``.

    Exactly one member must be the leader; it is moved to index 0 regardless
    of the order given, matching "Leader is always the first member" from the
    reference design. Each member gets its own fresh session id — an
    independent conversation, never shared with the others.

    ``workspace``, if given, must already exist as a directory (same rule
    ``project_store.set_project_dir`` enforces) -- validated before anything
    is persisted, so a bad path fails the whole create rather than leaving a
    team with some members bound and others not.

    ``org_id`` (optional) links this team under a tenancy org for the Org
    Graph view (``agent/workspace/org_graph.py``) -- None on a legacy/no-
    account install or when the creator has no org, same as every other
    optional field here. A team already existed as a global, org-less
    concept before the Org Graph feature; this only lets one be *tagged*
    with an org, it was never scoped to one.
    """
    if not name or not name.strip():
        raise ValueError("name is required")
    if not members:
        raise ValueError("at least one member is required")
    leaders = [m for m in members if m.get("role") == "leader"]
    if len(leaders) != 1:
        raise ValueError("exactly one member must be the leader")

    ordered = leaders + [m for m in members if m.get("role") != "leader"]
    now = time.time()
    team = {
        "id": _new_id("team"),
        "name": name.strip(),
        "created_at": now,
        "updated_at": now,
        "workspace": None,
        "session_mode": "independent",
        "org_id": org_id,
        "members": [
            {
                "slot_id": _new_id("slot"),
                "agent_id": m["agent_id"],
                "role": m.get("role", "teammate"),
                "session_id": _new_id("session"),
            }
            for m in ordered
        ],
    }
    if workspace:
        normalized = None
        for member in team["members"]:
            normalized = _bind_workspace(member["agent_id"], member["session_id"], workspace)
        team["workspace"] = normalized
    with _lock:
        data = _load()
        data["teams"][team["id"]] = team
        _save(data)
    _seed_leader_briefing(team)
    return team


def _seed_leader_briefing(team: Dict) -> None:
    """Write the roster + how-to-delegate into the Leader's own message
    history (not just the frontend's decorative empty-state greeting --
    see team_leader_greeting in channel/web/static/js/boot.js), so it is
    part of the actual context the model sees on its very first turn.

    Without this the Leader has no way to know its teammates are named,
    addressable Agents in team_manage rather than the generic subagent
    tool's disposable workers -- confirmed live: a Leader asked to "run my
    software company" reached for subagent and left every teammate's own
    pane in the grid empty, exactly the bug this closes.

    Best-effort and silent on failure: a team is still fully usable without
    its briefing, just less discoverable, so this must never block create.
    """
    if team.get("session_mode") != "independent":
        return
    leader = next((m for m in team["members"] if m["role"] == "leader"), None)
    if not leader:
        return
    try:
        from agent.memory import get_conversation_store
        from agent.registry import get_agent_registry

        registry = get_agent_registry()

        def _name(agent_id: str) -> str:
            try:
                return registry.get(agent_id).name
            except Exception:
                return agent_id

        lines = [
            f'[Team setup] You are the Leader of the Team "{team["name"]}" '
            f'(your own agent_id is "{leader["agent_id"]}" -- every team_manage call needs it). '
            "Your teammates, each with their own independent conversation "
            "(their own column in the Teams grid):",
        ]
        for m in team["members"]:
            if m["role"] == "leader":
                continue
            lines.append(f'- {_name(m["agent_id"])} (agent_id: "{m["agent_id"]}")')
        lines.append(
            "\nIMPORTANT: for ANY multi-step or multi-part request (building "
            "an app, a full stack, several features), do NOT use your own "
            "internal multi-agent workflow -- no STATE.md, no subagents "
            "directory, no gate/pass files, no generic subagent tool. Those "
            "workers are invisible and disposable; the named teammates above "
            "are real, with their own visible panes in the Teams grid, and "
            "that visibility is the entire point of this Team. Break the "
            "request into pieces yourself and hand each piece to a named "
            "teammate by calling team_manage: action=\"delegate\", "
            f'team_id="{team["id"]}", target_agent_id="<their agent_id>", '
            'task="<what to do>". Their reply comes back to you here, and also '
            "shows up in their own column as it happens."
        )

        # A lone assistant-role row never becomes its own display turn --
        # conversation_store.py's _group_into_display_turns only starts a
        # turn on a *user* message, so a solo assistant row would silently
        # never appear in /api/history even though it is in the model's
        # context (confirmed live: load_messages saw it, the web UI never
        # did). A real (user, assistant) pair renders correctly in both and
        # reads, honestly, as what it is -- a setup note, not small talk --
        # rather than a fake thing the human said.
        setup_msg = {"role": "user", "content": [{"type": "text", "text": "\n".join(lines)}]}
        ack_msg = {
            "role": "assistant",
            "content": [{"type": "text", "text": f'Understood — I\'ll delegate real work to my team via team_manage.'}],
        }

        profile = registry.get(leader["agent_id"])
        store = get_conversation_store(profile.workspace)
        store.append_messages(leader["session_id"], [setup_msg, ack_msg], channel_type="web")
    except Exception as e:
        logger.warning(f"[TeamStore] Could not seed leader briefing for {team.get('id')}: {e}")


def rename_team(team_id: str, name: str) -> Optional[Dict]:
    if not name or not name.strip():
        raise ValueError("name is required")
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if not team:
            return None
        team["name"] = name.strip()
        team["updated_at"] = time.time()
        _save(data)
    return team


def delete_team(team_id: str) -> bool:
    with _lock:
        data = _load()
        if team_id not in data["teams"]:
            return False
        del data["teams"][team_id]
        _save(data)
    return True


def add_member(team_id: str, agent_id: str) -> Optional[Dict]:
    """Adds a teammate slot (never a leader — a team always keeps its one
    leader from creation; use a new team to change leaders). A team with a
    workspace binds the new slot's session to it too, same as every existing
    member -- joining late must not mean working from a different folder."""
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if not team:
            return None
        slot = {
            "slot_id": _new_id("slot"),
            "agent_id": agent_id,
            "role": "teammate",
            "session_id": _new_id("session"),
        }
        if team.get("workspace"):
            _bind_workspace(agent_id, slot["session_id"], team["workspace"])
        team["members"].append(slot)
        team["updated_at"] = time.time()
        _save(data)
    return team


def remove_member(team_id: str, slot_id: str) -> Optional[Dict]:
    """Removes a teammate slot. Refuses to remove the leader — matches the
    reference design, where the leader is never removable or draggable."""
    with _lock:
        data = _load()
        team = data["teams"].get(team_id)
        if not team:
            return None
        target = next((m for m in team["members"] if m["slot_id"] == slot_id), None)
        if target is None:
            return team
        if target.get("role") == "leader":
            raise ValueError("the leader cannot be removed")
        team["members"] = [m for m in team["members"] if m["slot_id"] != slot_id]
        team["updated_at"] = time.time()
        _save(data)
    return team


# =====================================================================
# Shared-session teams: the composer's "invite a teammate into this chat"
# feature, unified onto this store instead of its own separate JSON file
# (agent.workspace.session_prefs used to own this alone). A "shared" team
# is the other collaboration model from the AionUi-ported "independent"
# one above: every member — leader included — points at the SAME
# session_id, because the whole point is one shared thread everyone can
# see and reply in, not each member working in their own conversation.
#
# session_prefs.get_prefs/set_prefs/members_index/forget_agent are the only
# callers of the four functions below; every other consumer of a
# conversation's roster (bridge/agent_bridge.py, agent/chat/service.py,
# agent/team_addressing.py, agent/tools/agent_delegate, ...) goes through
# session_prefs and is unaffected by this file existing underneath it.
# =====================================================================

def _owner_key(agent_id: Optional[str]) -> str:
    # Matches session_prefs._session_key's own "unset means default" rule,
    # so a shared team created under one alias is found under the other.
    return agent_id or "default"


def _find_shared_team(data: Dict, owner_agent_id: str, session_id: str) -> Optional[Dict]:
    owner_key = _owner_key(owner_agent_id)
    for team in data["teams"].values():
        if team.get("session_mode") != "shared":
            continue
        leader = next((m for m in team["members"] if m["role"] == "leader"), None)
        if leader and _owner_key(leader["agent_id"]) == owner_key and leader["session_id"] == session_id:
            return team
    return None


def get_shared_members(owner_agent_id: Optional[str], session_id: str) -> List[str]:
    """Teammate ids invited into this conversation (owner excluded) — the
    read side of what session_prefs's `members` field used to store."""
    if not session_id:
        return []
    with _lock:
        data = _load()
        team = _find_shared_team(data, owner_agent_id, session_id)
    if not team:
        return []
    return [m["agent_id"] for m in team["members"] if m["role"] != "leader"]


def set_shared_members(owner_agent_id: Optional[str], session_id: str, member_ids: Optional[List[str]]) -> List[str]:
    """Reconcile this conversation's teammate roster to exactly `member_ids`
    (deduped, order preserved). Not filtered against the owner's own id --
    the old session_prefs-backed field never was either, callers are already
    expected to exclude themselves, and every reader of this list already
    dedupes against the owner separately (see _roster_from_members). Empty/
    None deletes the shared team; a first invite creates one. Every member
    shares this same session_id — that never changes, only who is in it does.
    Returns the resulting teammate id list, same shape the old field did."""
    cleaned = [m for m in dict.fromkeys(member_ids or []) if m]

    with _lock:
        data = _load()
        team = _find_shared_team(data, owner_agent_id, session_id)

        if not cleaned:
            if team:
                del data["teams"][team["id"]]
                _save(data)
            return []

        now = time.time()
        if team is None:
            team = {
                "id": _new_id("team"),
                "name": "Shared chat",
                "created_at": now,
                "updated_at": now,
                "workspace": None,
                "session_mode": "shared",
                "members": [{
                    "slot_id": _new_id("slot"), "agent_id": owner_agent_id or "default",
                    "role": "leader", "session_id": session_id,
                }],
            }
            data["teams"][team["id"]] = team

        leader = next(m for m in team["members"] if m["role"] == "leader")
        # Slot ids for surviving members carry over rather than being reminted,
        # so a client mid-render of the old roster isn't holding dangling ids.
        existing_by_agent = {m["agent_id"]: m for m in team["members"] if m["role"] != "leader"}
        team["members"] = [leader] + [
            existing_by_agent.get(mid) or {
                "slot_id": _new_id("slot"), "agent_id": mid,
                "role": "teammate", "session_id": session_id,
            }
            for mid in cleaned
        ]
        team["updated_at"] = now
        _save(data)
    return cleaned


def shared_members_index() -> Dict[tuple, List[str]]:
    """Every shared-session conversation's teammate roster, keyed
    ``(owner_agent_id, session_id)`` — replaces session_prefs.members_index()."""
    with _lock:
        data = _load()
    index: Dict[tuple, List[str]] = {}
    for team in data["teams"].values():
        if team.get("session_mode") != "shared":
            continue
        leader = next((m for m in team["members"] if m["role"] == "leader"), None)
        if not leader:
            continue
        index[(leader["agent_id"], leader["session_id"])] = [
            m["agent_id"] for m in team["members"] if m["role"] != "leader"
        ]
    return index


def forget_agent_from_shared_teams(agent_id: str) -> None:
    """A deleted Agent leaves two dangling references in shared teams, same
    as session_prefs.forget_agent used to prune from its own file: its own
    shared conversations (it was the owner — the whole team goes with it,
    there is no conversation left to have), and its id as a ghost teammate
    in everyone else's roster."""
    if not agent_id:
        return
    with _lock:
        data = _load()
        changed = False
        for tid in list(data["teams"].keys()):
            team = data["teams"][tid]
            if team.get("session_mode") != "shared":
                continue
            leader = next((m for m in team["members"] if m["role"] == "leader"), None)
            if leader and leader["agent_id"] == agent_id:
                del data["teams"][tid]
                changed = True
                continue
            before = len(team["members"])
            team["members"] = [m for m in team["members"] if m["role"] == "leader" or m["agent_id"] != agent_id]
            if len(team["members"]) == before:
                continue
            changed = True
            if len(team["members"]) <= 1:
                del data["teams"][tid]
            else:
                team["updated_at"] = time.time()
        if changed:
            _save(data)
