"""The Analytics dashboard's endpoint: /api/analytics.

Real aggregates only, computed from data this instance already tracks --
conversation volume (agent/memory/conversation_store.py), egress call volume
(agent/audit/log.py's tamper-evident chain -- same source the Sovereignty
ledger reads), and Team task-board throughput (agent/workspace/team_store.py,
agent/tools/team/autopilot.py). Nothing here is estimated; a metric with no
real signal today (e.g. autopilot activity before any team has run it) simply
reports zero rather than being invented.
"""

import json
import time

import web

from channel.web.core._common import _get_workspace_root, _request_agent_id, _require_auth
from common.log import logger

TREND_DAYS = 14
ALLOWED_TREND_DAYS = (7, 14, 30, 90)


def _daily_query_trend(agent_id: str, days: int) -> list:
    try:
        from agent.memory.conversation_store import get_conversation_store

        store = get_conversation_store(_get_workspace_root(agent_id=agent_id))
        return store.get_daily_query_counts(days=days)
    except Exception as e:
        logger.debug(f"[Analytics] query trend failed: {e}")
        return []


def _per_agent_query_counts(days: int) -> list:
    """Total visible-query count per Agent over the window, sorted busiest
    first -- same get_daily_query_counts() the single-agent trend uses, just
    summed per Agent instead of read for one. Every Agent shares one
    conversation-store file (see agent/memory/conversation_store.py's
    get_conversation_store docstring), so this is one query per Agent
    against an already-open connection, not per-Agent I/O."""
    try:
        from agent.memory.conversation_store import get_conversation_store
        from agent.registry import get_agent_registry

        agents = get_agent_registry().list(include_disabled=False)
        counts = []
        for profile in agents:
            try:
                store = get_conversation_store(_get_workspace_root(agent_id=profile.id))
                total = sum(p["count"] for p in store.get_daily_query_counts(days=days))
            except Exception as e:
                logger.debug(f"[Analytics] per-agent count failed for {profile.id}: {e}")
                total = 0
            if total:
                counts.append({"agent_id": profile.id, "agent_name": profile.name, "count": total})
        return sorted(counts, key=lambda e: -e["count"])
    except Exception as e:
        logger.debug(f"[Analytics] per-agent breakdown failed: {e}")
        return []


def _daily_egress_trend(tenant_id, days: int) -> dict:
    """Egress calls per day plus a by-tool breakdown over the same window --
    one pass over the audit chain, the same source the Sovereignty ledger
    reads (agent/audit/log.py), just bucketed by day instead of left flat."""
    cutoff = time.time() - days * 86400
    by_day: dict = {}
    by_tool: dict = {}
    try:
        from agent.audit.log import iter_events

        for record in iter_events(event_type="egress", tenant_id=tenant_id):
            ts = record.get("ts") or 0
            if ts < cutoff:
                continue
            day = time.strftime("%Y-%m-%d", time.gmtime(ts))
            by_day[day] = by_day.get(day, 0) + 1
            tool = str((record.get("detail") or {}).get("tool") or "unknown")
            by_tool[tool] = by_tool.get(tool, 0) + 1
    except ImportError:
        # agent/audit/log.py not landed yet -- degrade to an empty trend
        # rather than fail the whole dashboard.
        pass
    except Exception as e:
        logger.warning(f"[Analytics] egress trend failed: {e}")
    trend = [{"date": d, "count": c} for d, c in sorted(by_day.items())]
    by_tool_list = sorted(
        ({"tool": t, "count": c} for t, c in by_tool.items()), key=lambda e: -e["count"]
    )
    return {"trend": trend, "by_tool": by_tool_list}


def _task_completion() -> dict:
    """Done-vs-total task counts per Team, from the same fleet-wide task list
    the Task Board renders (agent/workspace/team_store.py)."""
    try:
        from agent.workspace import team_store

        tasks = team_store.list_all_tasks()
    except Exception as e:
        logger.debug(f"[Analytics] task completion failed: {e}")
        return {"teams": [], "total": 0, "done": 0}

    per_team: dict = {}
    for task in tasks:
        tid = task.get("team_id") or "unknown"
        entry = per_team.setdefault(
            tid, {"team_id": tid, "team_name": task.get("team_name") or tid, "total": 0, "done": 0}
        )
        entry["total"] += 1
        if task.get("status") == "done":
            entry["done"] += 1
    teams = sorted(per_team.values(), key=lambda e: -e["total"])
    return {"teams": teams, "total": len(tasks), "done": sum(t["done"] for t in teams)}


def _autopilot_accuracy() -> dict:
    """Among tasks Autopilot has actually run -- identified by a
    ``verify_note``, a field only agent/tools/team/autopilot.py's self-check
    step ever writes (the Task Board's manual status-change endpoint,
    channel/web/api/task_board.py's BoardTaskHandler, only ever sets
    ``status``) -- how many landed on "done" without a human needing to step
    in, versus how many Autopilot itself flagged back to "review"."""
    try:
        from agent.workspace import team_store

        tasks = team_store.list_all_tasks()
    except Exception as e:
        logger.debug(f"[Analytics] autopilot accuracy failed: {e}")
        return {"touched": 0, "auto_done": 0, "needs_review": 0}

    touched = [t for t in tasks if t.get("verify_note")]
    auto_done = sum(1 for t in touched if t.get("status") == "done")
    return {"touched": len(touched), "auto_done": auto_done, "needs_review": len(touched) - auto_done}


def build_metrics(agent_id: str = None, tenant_id=None, days: int = TREND_DAYS) -> dict:
    egress = _daily_egress_trend(tenant_id, days)
    return {
        "trend_days": days,
        "query_trend": _daily_query_trend(agent_id, days),
        "per_agent_queries": _per_agent_query_counts(days),
        "egress_trend": egress["trend"],
        "egress_by_tool": egress["by_tool"],
        "task_completion": _task_completion(),
        "autopilot_accuracy": _autopilot_accuracy(),
    }


class AnalyticsMetricsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from common.runtime_identity import current_identity

            params = web.input(agent_id='', days='')
            try:
                days = int(params.days) if params.days else TREND_DAYS
            except ValueError:
                days = TREND_DAYS
            if days not in ALLOWED_TREND_DAYS:
                days = TREND_DAYS
            metrics = build_metrics(_request_agent_id(params), current_identity().org_id, days=days)
            return json.dumps({"status": "success", "metrics": metrics}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[Analytics] metrics failed: {e}")
            return json.dumps({"status": "error", "message": "Could not build analytics metrics"})
