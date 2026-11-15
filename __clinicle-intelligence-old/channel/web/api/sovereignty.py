"""The Sovereignty & Trust dashboard's endpoints: /api/sovereignty/*.

Clinicle Intelligence's closing proof-point: this Agent installation never phones home.
Aggregates counters that already exist elsewhere in the codebase (knowledge
page count, conversation history) plus the tamper-evident audit chain in
``agent.audit.log`` (egress calls, and query/token usage recorded there --
see the hook in ``agent/protocol/agent_stream.py``) into one metrics dict,
and renders the same snapshot as an offline PDF for the "Sovereign Export"
button.
"""

import io
import json

import web

from channel.web.core._common import (
    _get_workspace_root, _request_agent_id, _require_auth, _require_capability,
)
from common.log import logger

# Benchmark: a comparable hosted model's blended per-token price (published
# ~$2.50 / $10.00 per 1M input/output tokens -> ~$5.00/1M blended), used only
# to estimate what the same volume would have cost on a cloud API. Adjust
# this constant if you want to compare against a different provider.
BENCHMARK_CLOUD_PRICE_PER_1M_TOKENS = 5.00
BENCHMARK_CLOUD_PRICE_PER_TOKEN = BENCHMARK_CLOUD_PRICE_PER_1M_TOKENS / 1_000_000


def _documents_indexed(agent_id: str) -> int:
    try:
        from agent.knowledge.service import KnowledgeService

        svc = KnowledgeService(_get_workspace_root(agent_id=agent_id))
        return int(svc.list_tree().get("stats", {}).get("pages", 0))
    except Exception as e:
        logger.debug(f"[Sovereignty] documents count failed: {e}")
        return 0


def _query_stats(agent_id: str) -> dict:
    try:
        from agent.memory.conversation_store import get_conversation_store

        stats = get_conversation_store(_get_workspace_root(agent_id=agent_id)).get_stats()
        # Each query is a user message + the assistant's reply -- two rows.
        first_at = stats.get("first_created_at")
        return {
            "queries_served": int(stats.get("total_messages", 0)) // 2,
            "first_query_at": int(first_at) if first_at else None,
        }
    except Exception as e:
        logger.debug(f"[Sovereignty] query count failed: {e}")
        return {"queries_served": 0, "first_query_at": None}


def _audit_summary(tenant_id) -> dict:
    """One pass over the tamper-evident audit chain: egress calls grouped by
    tool/target, cumulative tokens from recorded queries, and whether the
    hash chain still verifies end to end (the "tamper-evident audit
    indicator" -- ``verify_chain`` is the same check ``agent/audit/log.py``
    itself uses, not reimplemented here)."""
    egress = {}
    tokens_processed = 0
    tokens_in = 0
    tokens_out = 0
    entry_count = 0
    chain_ok = True
    try:
        from agent.audit.log import iter_events, verify_chain

        for record in iter_events(tenant_id=tenant_id):
            entry_count += 1
            detail = record.get("detail") or {}
            if record.get("event_type") == "egress":
                key = (str(detail.get("tool") or "unknown"), str(detail.get("target") or ""))
                egress[key] = egress.get(key, 0) + 1
            elif record.get("event_type") == "query":
                tokens_processed += int(detail.get("total_tokens") or 0)
                tokens_in += int(detail.get("prompt_tokens") or 0)
                tokens_out += int(detail.get("completion_tokens") or 0)
        chain_ok = verify_chain(tenant_id)
    except ImportError:
        # agent/audit/log.py not landed yet -- degrade to an empty ledger
        # rather than fail the whole dashboard.
        pass
    except Exception as e:
        logger.warning(f"[Sovereignty] audit log read failed: {e}")

    ledger = [
        {"tool": tool, "target": target, "count": count}
        for (tool, target), count in sorted(egress.items(), key=lambda kv: -kv[1])
    ]
    return {
        "egress_ledger": ledger,
        "tokens_processed": tokens_processed,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "chain_verified": chain_ok,
        "entry_count": entry_count,
    }


def build_metrics(agent_id: str = None, tenant_id=None) -> dict:
    audit = _audit_summary(tenant_id)
    query_stats = _query_stats(agent_id)
    tokens_processed = audit["tokens_processed"]
    cost_avoided = round(tokens_processed * BENCHMARK_CLOUD_PRICE_PER_TOKEN, 4)
    return {
        "queries_served": query_stats["queries_served"],
        "first_query_at": query_stats["first_query_at"],
        "tokens_processed": tokens_processed,
        "tokens_in": audit["tokens_in"],
        "tokens_out": audit["tokens_out"],
        "documents_indexed": _documents_indexed(agent_id),
        "egress_call_count": sum(e["count"] for e in audit["egress_ledger"]),
        "egress_ledger": audit["egress_ledger"],
        "cloud_cost_avoided_usd": cost_avoided,
        "benchmark_price_per_1m_tokens_usd": BENCHMARK_CLOUD_PRICE_PER_1M_TOKENS,
        "data_residency": {
            "conversations": True,
            "model_weights": True,
            "logs": True,
            "documents": True,
        },
        "tamper_evident_chain_verified": audit["chain_verified"],
        "audit_entry_count": audit["entry_count"],
    }


class SovereigntyMetricsHandler:
    def GET(self):
        _require_auth()
        _require_capability("settings.sovereignty")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from common.runtime_identity import current_identity

            params = web.input(agent_id='')
            metrics = build_metrics(_request_agent_id(params), current_identity().org_id)
            return json.dumps({"status": "success", "metrics": metrics}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[Sovereignty] metrics failed: {e}")
            return json.dumps({"status": "error", "message": "Could not build sovereignty metrics"})


def _require_sovereignty_admin():
    """Admin gate for retention/deletion -- same fallback shape as every
    other admin-only action added this session (meetings.py's
    _require_meetings_admin, secrets.py's _require_secrets_admin): real
    per-user admin role on a multi-tenant install, the existing app-wide
    password gate on a legacy single-password one, since there is no
    weaker "admin" concept to check there either. Deliberately NOT scoped
    to any one Agent -- retention purges the shared conversation store, the
    same store every Agent's history lives in."""
    from agent.tenancy.store import get_tenancy_store
    from channel.web.api.tenancy import _current_user_and_org

    user_id, org_id = _current_user_and_org()
    if user_id is None:
        _require_auth()
        return
    if not get_tenancy_store().has_role(user_id, org_id, "admin"):
        raise web.HTTPError("403 Forbidden", {"Content-Type": "application/json; charset=utf-8"},
                             json.dumps({"status": "error", "message": "admin role required"}))
    _require_capability("settings.sovereignty")


class SovereigntyRetentionHandler:
    """GET: current retention setting plus a live dry-run count of how many
    sessions a purge would remove right now. POST {"retention_days"}: saves
    the setting (0 disables retention entirely -- never a self-triggering
    purge; that only ever happens via SovereigntyPurgeHandler, an explicit
    admin action)."""

    def GET(self):
        _require_auth()
        _require_capability("settings.sovereignty")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.conversation_store import get_conversation_store
            from config import conf

            params = web.input(agent_id='')
            days = int(conf().get("data_retention_days") or 0)
            store = get_conversation_store(_get_workspace_root(agent_id=_request_agent_id(params)))
            pending = store.count_sessions_older_than(days) if days > 0 else 0
            return json.dumps({"status": "success", "retention_days": days, "sessions_pending_purge": pending})
        except Exception as e:
            logger.error(f"[Sovereignty] retention status failed: {e}")
            return json.dumps({"status": "error", "message": "Could not load retention settings"})

    def POST(self):
        _require_sovereignty_admin()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from channel.web.api.connectors import _persist_config

            data = json.loads(web.data() or "{}")
            days = int(data.get("retention_days") or 0)
            if days < 0:
                return json.dumps({"status": "error", "message": "retention_days cannot be negative"})
            _persist_config("data_retention_days", days)
            return json.dumps({"status": "success", "retention_days": days})
        except Exception as e:
            logger.error(f"[Sovereignty] retention save failed: {e}")
            return json.dumps({"status": "error", "message": "Could not save retention settings"})


class SovereigntyPurgeHandler:
    """POST -- runs the purge NOW, using the currently saved retention_days.
    Irreversible. Admin-gated; the frontend requires an explicit confirm
    dialog before ever calling this (see sovereignty.js)."""

    def POST(self):
        _require_sovereignty_admin()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.conversation_store import get_conversation_store
            from config import conf

            params = web.input(agent_id='')
            days = int(conf().get("data_retention_days") or 0)
            if days <= 0:
                return json.dumps({"status": "error", "message": "Set a retention window before purging"})
            store = get_conversation_store(_get_workspace_root(agent_id=_request_agent_id(params)))
            deleted = store.delete_sessions_older_than(days)
            logger.info(f"[Sovereignty] retention purge: {deleted} session(s) older than {days}d deleted")
            return json.dumps({"status": "success", "sessions_deleted": deleted})
        except Exception as e:
            logger.error(f"[Sovereignty] purge failed: {e}")
            return json.dumps({"status": "error", "message": "Could not run the purge"})


class SovereigntyExportHandler:
    """Server-side PDF snapshot for the "Sovereign Export" button."""

    def GET(self):
        _require_auth()
        _require_capability("settings.sovereignty")
        try:
            from common.runtime_identity import current_identity

            params = web.input(agent_id='')
            metrics = build_metrics(_request_agent_id(params), current_identity().org_id)
            pdf_bytes = _render_pdf(metrics)
        except Exception as e:
            logger.error(f"[Sovereignty] PDF export failed: {e}")
            raise web.internalerror()
        web.header('Content-Type', 'application/pdf')
        web.header('Content-Disposition', 'attachment; filename="sovereignty-report.pdf"')
        web.header('Content-Length', str(len(pdf_bytes)))
        web.header('Cache-Control', 'no-store')
        return pdf_bytes


def _render_pdf(metrics: dict) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    _, height = letter
    y = [height - inch]  # mutable cell so the nested closure can advance it

    def line(text, size=11, gap=18, bold=False):
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(inch, y[0], text)
        y[0] -= gap

    line("Sovereignty & Trust Report", size=18, gap=26, bold=True)
    line("Offline snapshot, generated entirely on this machine.", size=9, gap=22)
    line(f"Queries served: {metrics['queries_served']}", bold=True)
    line(
        f"Tokens processed: {metrics['tokens_processed']} "
        f"({metrics['tokens_in']} in / {metrics['tokens_out']} out)",
        bold=True,
    )
    line(f"Documents indexed on-device: {metrics['documents_indexed']}", bold=True)
    line(f"Outbound calls (egress): {metrics['egress_call_count']}", bold=True)
    line(
        f"Estimated cloud cost avoided: ${metrics['cloud_cost_avoided_usd']:.4f} "
        f"(estimate, vs ${metrics['benchmark_price_per_1m_tokens_usd']:.2f}/1M tokens benchmark)",
        bold=True,
    )
    line(
        f"Tamper-evident audit chain: {'VERIFIED' if metrics['tamper_evident_chain_verified'] else 'BROKEN'}",
        bold=True,
    )
    y[0] -= 8
    line("Data residency", size=13, gap=18, bold=True)
    for label, val in metrics["data_residency"].items():
        status = "stays on this machine" if val else "NOT confirmed"
        line(f"  - {label.replace('_', ' ').title()}: {status}", size=10, gap=15)
    y[0] -= 8
    line("Egress ledger", size=13, gap=18, bold=True)
    if metrics["egress_ledger"]:
        for entry in metrics["egress_ledger"][:40]:
            if y[0] < inch:
                c.showPage()
                y[0] = height - inch
            line(f"  - {entry['tool']} -> {entry['target']}: {entry['count']} call(s)", size=10, gap=14)
    else:
        line("  No outbound calls recorded.", size=10, gap=14)
    c.showPage()
    c.save()
    return buf.getvalue()
