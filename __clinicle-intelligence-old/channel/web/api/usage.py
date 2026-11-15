"""Usage/cost endpoint: /api/usage/summary.

Read side over agent/memory/conversation_store.py's usage_events table
(agent/protocol/agent_stream.py writes it, gated behind the
enable_cost_tracking config flag). With that flag off -- the default --
this always returns zeroed totals, since nothing was ever recorded; it is
not itself gated on the flag, same as any other read endpoint over a table
that simply happens to be empty.
"""

import json

import web

from agent.memory import get_conversation_store
from channel.web.core._common import _require_auth, _require_capability

# Same allowed window as the Analytics dashboard's own trend (channel/web/
# api/analytics.py) -- one shared convention for "how far back" across every
# chart in this console, not a value specific to cost.
ALLOWED_TREND_DAYS = (7, 14, 30, 90)
DEFAULT_TREND_DAYS = 14


class UsageSummaryHandler:
    """GET /api/usage/summary?agent_id=<id>&since=<epoch>&days=<n> -- token/
    cost totals (overall and by model) plus a daily trend for the chart.
    ``agent_id`` omitted lists every Agent's usage (same convention as
    ConversationStore.list_runs); the empty string scopes to the default
    Agent specifically. ``days`` (7/14/30/90, default 14) sets the trend
    window; ``since`` (epoch seconds) independently bounds the totals/by_model
    figures, same as before -- the two are deliberately separate knobs since
    a chart's window and a totals cutoff answer different questions."""

    def GET(self):
        _require_auth()
        _require_capability("analytics")
        web.header('Content-Type', 'application/json; charset=utf-8')

        # web.input() with no defaults returns only the params actually
        # present, so .get(..., None) tells "omitted" (list every Agent)
        # apart from "?agent_id=" (the default Agent specifically) -- a
        # string default here would collapse that distinction.
        raw = web.input()
        agent_id = raw.get("agent_id", None)
        since = None
        if raw.get("since"):
            try:
                since = int(raw["since"])
            except ValueError:
                since = None
        try:
            days = int(raw.get("days") or DEFAULT_TREND_DAYS)
        except ValueError:
            days = DEFAULT_TREND_DAYS
        if days not in ALLOWED_TREND_DAYS:
            days = DEFAULT_TREND_DAYS

        store = get_conversation_store()
        summary = store.get_usage_summary(agent_id=agent_id, since=since)
        trend = store.get_daily_usage_trend(agent_id=agent_id, days=days)
        return json.dumps(
            {"status": "success", "trend_days": days, "trend": trend, **summary},
            ensure_ascii=False,
        )
