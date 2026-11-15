"""Single point of truth for where an Agent's state lives on disk.

Two rules keep later work cheap, and both matter:

1. This is the only module that reads ``agent_workspace`` from config.
2. This is the only module that knows the directory layout. Callers ask for
   ``memory_dir()``; they never write ``os.path.join(root, "memory")``. Without
   this second rule, inserting the per-user layer means editing every call site
   a second time.

State falls into three kinds, and which kind a path is decided here:

- **Shared** (``shared_root``): skills, knowledge, MCP servers, credentials,
  products. Copying these per Agent costs an update in N places and a version
  drift; what actually differs between Agents is which ones are switched on,
  not which ones exist. An Agent that genuinely needs its own copy creates the
  directory and wins by presence.
- **Per Agent** (``state_root``): persona, sessions, scratch, published files.
  What makes this Agent a different one from that Agent. Scheduled tasks are
  shared (each task carries its own ``agent_id``) so re-binding a channel
  instance never has to move a file.
- **Per end user** (``user_root``): profile, preferences, memory, task records.
  "Wang likes email over phone calls" is a fact about Wang, not about one
  Agent, so it sits beside the Agents rather than under one of them.

Everything collapses onto the workspace root on a single-Agent install with no
end users, so every path resolves exactly where it does today and the layout
change needs no migration.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

from common.runtime_identity import RuntimeIdentity, current_identity


class StateDirError(RuntimeError):
    """Raised when an identity names an Agent that does not exist."""


# _default_org_id() sits on the ambient-identity path hit by every bare
# state_root()/shared_root() call -- multiple times per chat turn (tools,
# skills, memory, review queue, ...). Uncached, each of those opened a fresh
# sqlite connection and re-ran the organizations query. A short TTL (same
# order as the Composio tool cache in tool_manager.py) keeps it honest if an
# org is added/removed while still eliminating the per-call DB round trip.
_default_org_id_cache: tuple = (0.0, None)  # (fetched_at, value)
_DEFAULT_ORG_ID_TTL_SECONDS = 30.0


def _default_org_id() -> Optional[str]:
    """The org an *ambient* identity with no ``org_id`` should resolve to.

    Only applies when a caller resolved no identity of its own and this
    module fell back to ``current_identity()`` -- never when a caller passes
    an explicit identity (even an empty ``RuntimeIdentity()``, as
    ``channel/web/api/agents.py``'s avatar lookup deliberately does, to force
    the single global root regardless of ambient state). Conflating those two
    was the actual bug: every store that calls ``shared_root()``/
    ``state_root()`` bare -- review queue, workflows, teams, projects,
    meetings, memory, knowledge, scheduler -- silently split into an
    org-scoped copy (whichever request path happened to bind identity) and an
    orphaned global copy (whichever didn't) that no authenticated request
    ever reads again.

    On an install with exactly one organization -- true today, and true for
    any single-tenant deployment -- that org is the only sane default.
    Ambiguous multi-org installs get None, same as before: guessing wrong
    there is worse than an explicit gap.
    """
    global _default_org_id_cache
    fetched_at, cached_value = _default_org_id_cache
    if (time.monotonic() - fetched_at) < _DEFAULT_ORG_ID_TTL_SECONDS:
        return cached_value

    try:
        from agent.tenancy.store import get_tenancy_store

        store = get_tenancy_store()
        conn = store._connect()
        try:
            rows = conn.execute("SELECT id FROM organizations LIMIT 2").fetchall()
        finally:
            conn.close()
    except Exception:
        # A transient failure must not evict an already-working cache entry
        # -- fall back to whatever was last known good rather than making
        # every subsequent ambient call fail open to the legacy root too.
        return cached_value

    value = str(rows[0][0]) if len(rows) == 1 else None
    _default_org_id_cache = (time.monotonic(), value)
    return value


def _resolve(identity: Optional[RuntimeIdentity]) -> RuntimeIdentity:
    if identity is not None:
        return identity
    ident = current_identity()
    if ident.org_id is None:
        ident = ident.derive(org_id=_default_org_id())
    return ident


def state_root(identity: Optional[RuntimeIdentity] = None) -> Path:
    """Workspace root of the Agent this work belongs to.

    An absent ``agent_id`` resolves to the default Agent: startup tasks such as
    skill sync and scheduler boot legitimately run before routing. An
    ``agent_id`` that does not resolve is a bug and raises rather than quietly
    falling back, which would leak one Agent's files into another's workspace.
    """
    from agent.registry import get_agent_registry

    ident = _resolve(identity)
    agent_id = ident.agent_id
    registry = get_agent_registry(org_id=ident.org_id)
    if not agent_id:
        return Path(registry.get(require_enabled=False).workspace)
    try:
        profile = registry.get(agent_id, require_enabled=False)
    except KeyError:
        raise StateDirError(f"unknown agent id: {agent_id!r}") from None
    return Path(profile.workspace)


def shared_root(identity: Optional[RuntimeIdentity] = None) -> Path:
    """Root of the assets every Agent (within one org) draws on.

    Implicitly the default Agent's workspace rather than a configured path of
    its own: on a single-Agent install that is the workspace root, so nothing
    moves, and a second Agent reads the skills and credentials that are already
    there instead of needing its own copies. Add a setting if someone ever
    wants the shared area somewhere else.

    Takes ``identity`` (and therefore respects ``org_id``) for the same reason
    ``state_root`` does: this is where skills, knowledge, MCP config and
    **API-key credentials** live — leaving this global would mean every org
    reads and writes the same credential file no matter how well `state_root`
    itself is isolated.
    """
    from agent.registry import get_agent_registry

    ident = _resolve(identity)
    return Path(get_agent_registry(org_id=ident.org_id).get(require_enabled=False).workspace)


def user_root(identity: Optional[RuntimeIdentity] = None) -> Path:
    """Root of the data owned by one end user.

    Beside the Agents, not under one of them: a user's preferences are the same
    fact whichever Agent is talking to them, and one copy per Agent would drift.

    Collapses onto the Agent's own root while ``user_id`` is unset, which is
    what makes the tenancy migration a change to this function rather than to
    every caller.
    """
    ident = _resolve(identity)
    if ident.user_id:
        return shared_root() / "users" / ident.user_id
    return state_root(ident)


def state_path(*parts: str, identity: Optional[RuntimeIdentity] = None) -> Path:
    """Escape hatch for paths with no named helper. Prefer adding a helper."""
    return state_root(identity).joinpath(*parts)


def _ensure(path: Path, ensure: bool) -> Path:
    if ensure:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _agent_base(identity, base) -> Path:
    return Path(base) if base is not None else state_root(identity)


def _user_base(identity, base) -> Path:
    return Path(base) if base is not None else user_root(identity)


def _shared_or_own(identity, base, *parts: str) -> Path:
    """Shared copy, unless this Agent has one of its own.

    Opting out is by presence rather than by configuration: an Agent that needs
    a private skill set or its own MCP servers creates the directory, and every
    other Agent goes on reading the single shared copy. Nothing to configure in
    the common case, and on a single-Agent install both branches name the same
    path anyway.

    Writes land on whichever of the two this returns, so an Agent that has not
    opted out contributes to the shared copy rather than quietly forking it.
    """
    own = _agent_base(identity, base).joinpath(*parts)
    if own.exists():
        return own
    return shared_root(identity).joinpath(*parts)


# ``base`` lets value objects that already carry a resolved root (MemoryConfig,
# KnowledgeService) reuse the layout without re-resolving an identity they do
# not have. It exists so the layout stays defined exactly once. It names the
# Agent's own root, not a self-contained one: shared assets still fall back to
# the shared copy when that root has none, which is what the callers passing it
# actually want.


# --- Shared: one copy every Agent draws on, unless it opts out ---------------


def skills_dir(identity=None, ensure: bool = False, base=None) -> Path:
    return _ensure(_shared_or_own(identity, base, "skills"), ensure)


def knowledge_dir(identity=None, ensure: bool = False, base=None) -> Path:
    return _ensure(_shared_or_own(identity, base, "knowledge"), ensure)


def subagents_dir(identity=None, ensure: bool = False, base=None) -> Path:
    """Sub agent templates. Shared like skills: sub agents have no identity of
    their own, they are a way work gets done."""
    return _ensure(_shared_or_own(identity, base, "subagents"), ensure)


def mcp_config_file(identity=None, base=None) -> Path:
    return _shared_or_own(identity, base, "mcp.json")


def env_file(identity=None, base=None) -> Path:
    """Credentials and model keys. Shared, because they belong to the person who
    runs the instance rather than to one of their Agents."""
    return _shared_or_own(identity, base, ".env")


def system_dir(base=None, ensure: bool = False) -> Path:
    """Instance-wide system state that isn't user config.

    Shared, not per Agent: things like the per-provider model catalog are a
    property of the instance (same as the global model keys), not of whichever
    Agent happens to be talking. Kept out of ``config.json`` so derived/managed
    documents don't bloat the hand-editable config.
    """
    root = Path(base) if base is not None else shared_root()
    return _ensure(root / "system", ensure)


def models_catalog_file(base=None) -> Path:
    """The per-provider model catalog overlay (overrides + hidden)."""
    return system_dir(base) / "models.json"


def scheduler_recipients_file(base=None) -> Path:
    """The one directory of people/groups observed on inbound IM channels.

    Shared, not per Agent: a contact is a fact about the person, not about which
    Agent happened to talk to them, so one copy lets any Agent's console build a
    scheduled task for anyone the instance has ever met. It lives beside the
    global ``tasks.json`` under ``scheduler`` — the recipients a scheduled push
    can target — rather than in a separate directory.
    """
    if base is not None:
        return Path(base) / "scheduler" / "recipients.json"
    return shared_root() / "scheduler" / "recipients.json"


def scheduler_file_global(base=None) -> Path:
    """The one task store every Agent's scheduled tasks live in.

    Shared, not per Agent, and each task carries its own ``agent_id`` (the Agent
    it runs as) plus ``instance_id`` (the channel login it delivers through).
    Keeping ownership *on the task* rather than *in the file path* is what lets a
    channel instance be re-bound to a different Agent without moving any task
    data: delivery resolves by ``instance_id`` and execution sets identity from
    the task's ``agent_id``, neither of which depends on where the file sits.

    Superseded the per-Agent ``scheduler_file`` (``<agent>/scheduler/tasks.json``);
    a one-time boot migration folds those into this single store.
    """
    if base is not None:
        return Path(base) / "scheduler" / "tasks.json"
    return shared_root() / "scheduler" / "tasks.json"


# --- Per Agent: what makes this Agent a different one -----------------------


def scheduler_file(identity=None, base=None) -> Path:
    return _agent_base(identity, base) / "scheduler" / "tasks.json"


def websites_dir(identity=None, ensure: bool = False, base=None) -> Path:
    """Web pages and files the Agent means to publish.

    Per Agent, unlike the skills and knowledge it draws on: this holds what one
    Agent produced, so a second Agent must not be able to overwrite it, and the
    files have to travel with the Agent they belong to. A serving layer in front
    of the workspace addresses an Agent's files by this path.
    """
    return _ensure(_agent_base(identity, base) / "websites", ensure)


def tmp_dir(identity=None, ensure: bool = True, base=None) -> Path:
    """Transient downloads and synthesized media.

    Agent-scoped for now. It holds inbound attachments, so it arguably belongs
    to the user; revisit when tenancy lands rather than guessing now.
    """
    return _ensure(_agent_base(identity, base) / "tmp", ensure)


# --- User-scoped: isolated per end user once tenancy lands -------------------


def memory_dir(identity=None, ensure: bool = False, base=None) -> Path:
    return _ensure(_user_base(identity, base) / "memory", ensure)


def memory_index_db(identity=None, ensure: bool = True, base=None) -> Path:
    """The index, not the content: one database per Agent, isolated per user by
    the ``user_id`` and ``scope`` columns rather than by path.

    Deliberately not under ``user_root``, unlike the memory files it indexes.
    It also holds the sessions and runs tables, which are per Agent, and a
    database per user would make "what do I know about Wang" a fan-out over N
    files. Filtering has to be applied at the retrieval entry point instead:
    miss one query and it is a cross-user leak, so there is exactly one place
    that may build these WHERE clauses.
    """
    index_dir = _ensure(_agent_base(identity, base) / "memory" / "long-term", ensure)
    return index_dir / "index.db"


def memory_file(identity=None, base=None) -> Path:
    return _user_base(identity, base) / "MEMORY.md"


def output_dir(identity=None, ensure: bool = False, base=None) -> Path:
    return _ensure(_user_base(identity, base) / "output", ensure)


def runs_dir(identity=None, ensure: bool = False, base=None) -> Path:
    """Task execution records. User-scoped because a trace holds full tool
    output: one user's runs must not be readable by another."""
    return _ensure(_user_base(identity, base) / "runs", ensure)


# --- Compatibility -----------------------------------------------------------


def state_root_str(identity: Optional[RuntimeIdentity] = None) -> str:
    """``state_root`` for the many call sites that still pass str paths around."""
    return str(state_root(identity))


def real_state_root(identity: Optional[RuntimeIdentity] = None) -> str:
    """Symlink-resolved root, for containment checks that compare prefixes."""
    return os.path.realpath(str(state_root(identity)))
