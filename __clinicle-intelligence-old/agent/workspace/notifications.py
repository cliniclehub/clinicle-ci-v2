"""Notifications aggregator: normalizes four independent "needs your
attention" surfaces -- Review Queue flags, Pending Edits, worktree merge
conflicts, and scheduler run completions -- into one flat, sorted list for
the header's notification bell (channel/web/api/notifications.py).

Read/unread state is intentionally NOT tracked here -- it lives entirely
client-side (channel/web/static/js/core/notifications.js), same precedent
as notify.js's own localStorage dedup set for scheduler-run toasts. This
module only answers "what's currently worth surfacing," not "has anyone
seen it."

Review Queue flags, Pending Edits and worktree conflicts are persistent:
each vanishes from its own store once resolved (status changes), so a
source's own status field already IS the "still needs attention" concept
-- no time window needed. Scheduler runs are the opposite: a completed run
stays 'done'/'error' forever, so without a window every run that ever
finished would count as a notification -- RUN_LOOKBACK_SECONDS_DEFAULT
bounds that to a recent lookback instead.

worktree.list_pending_worktrees() and the runs table are not org-scoped
today (see worktree.py's own comment above _REGISTRY_PATH and the runs
table's unused user_id column) -- this aggregator inherits that. Fine on
today's single-org install; a future multi-org rollout needs those two
scoped at the source first, not patched in here.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from agent.subagent import worktree
from agent.workspace import pending_edits_store, review_queue_store

RUN_LOOKBACK_SECONDS_DEFAULT = 24 * 60 * 60
RUN_STATUSES = ("done", "error")

# Cross-agent system maintenance runs (stall watchdog, worktree orphan sweep --
# see agent/tools/scheduler/integration.py's seed_stall_watchdog_task/
# seed_worktree_sweep_task) fire every few minutes and would otherwise flood
# the bell with noise no human asked to be notified about. Same exclusion set
# task_store.py's own _SYSTEM_TASK_TYPES uses to keep these off the Scheduled
# Tasks list -- duplicated here since that one's local to a function, not an
# importable constant.
_SYSTEM_RUN_ACTION_TYPES = ("stall_watchdog", "worktree_sweep")


def _item(id_: str, type_: str, title: str, detail: str, target_view: str,
          created_at: float) -> Dict[str, Any]:
    """Shared shape for the three persistent sources (review flags, pending
    edits, worktree conflicts) -- each vanishes from its own store once
    resolved, so none needs a target_tab or a persistent=False variant."""
    return {
        "id": id_, "type": type_, "persistent": True, "title": title, "detail": detail,
        "target_view": target_view, "target_tab": None, "created_at": created_at,
    }


def _review_flags(org_id: Optional[str]) -> List[Dict[str, Any]]:
    return [
        _item(f["id"], "review_flag", f.get("title", ""), f.get("category", ""),
              "review-queue", f.get("created_at", 0))
        for f in review_queue_store.list_flags(org_id, status="open")
    ]


def _pending_edits(org_id: Optional[str]) -> List[Dict[str, Any]]:
    return [
        _item(e["id"], "pending_edit", (e.get("tool_name") or "edit").title(), e.get("path", ""),
              "pending-edits", e.get("created_at", 0))
        for e in pending_edits_store.list_pending_edits(org_id, status="pending")
    ]


def _worktree_conflicts() -> List[Dict[str, Any]]:
    return [
        _item(w["id"], "worktree_conflict", w.get("task_name") or w.get("branch", ""),
              "Merge conflict", "worktrees", w.get("created_at", 0))
        for w in worktree.list_pending_worktrees() if w.get("merge_conflict")
    ]


def _run_completions(runs_since: Optional[float], limit: int) -> List[Dict[str, Any]]:
    from agent.memory import get_conversation_store
    store = get_conversation_store()
    if store is None:
        return []
    since = runs_since if runs_since is not None else time.time() - RUN_LOOKBACK_SECONDS_DEFAULT
    items = []
    # list_runs() filters on one status value, not a set -- one call per status.
    for status in RUN_STATUSES:
        for r in store.list_runs(task_source="scheduler", status=status, since=int(since), limit=limit):
            extras = r.get("extras") or {}
            if extras.get("action_type") in _SYSTEM_RUN_ACTION_TYPES:
                continue
            items.append({
                "id": r["run_id"], "type": f"run_{status}", "persistent": False,
                "title": extras.get("task_name") or r.get("task_id") or "Task",
                "detail": (extras.get("output_preview") or r.get("error") or "")[:160],
                # A run isn't a navigateTo() target -- it opens a chat session
                # (channel/web/static/js/core/notify.js's broadcastOpenSession),
                # same as the existing scheduler-run OS toast already does.
                "target_view": None, "target_session_id": r.get("session_id"),
                "target_agent_id": r.get("agent_id"),
                "created_at": r.get("started_at", 0),
            })
    return items


def list_notifications(org_id: Optional[str], *, runs_since: Optional[float] = None,
                        runs_limit: int = 20) -> List[Dict[str, Any]]:
    items = (
        _review_flags(org_id) + _pending_edits(org_id)
        + _worktree_conflicts() + _run_completions(runs_since, runs_limit)
    )
    items.sort(key=lambda n: n.get("created_at", 0), reverse=True)
    return items
