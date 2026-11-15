# encoding:utf-8
"""build_metrics must return a well-formed dict whether the audit log is
empty (fresh install) or has egress/query records in it, and must never
raise just because agent.knowledge/agent.memory lookups fail (an install
that has never opened a knowledge base or had a conversation yet)."""

import json

from channel.web.api.sovereignty import build_metrics


def _empty_metrics(monkeypatch, tmp_path):
    # agent/audit/log.py's own demo() patches this same module-level name to
    # redirect the log to a scratch file -- same technique here.
    monkeypatch.setattr("agent.audit.log._log_path", lambda: tmp_path / "events.jsonl")
    monkeypatch.setattr("channel.web.api.sovereignty._documents_indexed", lambda agent_id: 0)
    monkeypatch.setattr(
        "channel.web.api.sovereignty._query_stats",
        lambda agent_id: {"queries_served": 0, "first_query_at": None},
    )


def test_empty_audit_log_yields_zeroed_metrics(monkeypatch, tmp_path):
    _empty_metrics(monkeypatch, tmp_path)

    metrics = build_metrics()

    assert metrics["egress_ledger"] == []
    assert metrics["egress_call_count"] == 0
    assert metrics["tokens_processed"] == 0
    assert metrics["cloud_cost_avoided_usd"] == 0
    assert metrics["tamper_evident_chain_verified"] is True
    assert metrics["data_residency"] == {
        "conversations": True, "model_weights": True, "logs": True, "documents": True,
    }


def test_metrics_aggregate_egress_and_query_records(monkeypatch, tmp_path):
    _empty_metrics(monkeypatch, tmp_path)
    from agent.audit.log import record_event

    record_event("org-1", "agent-a", "egress", {"tool": "OUTLOOK_SEND_EMAIL", "target": "inbox"})
    record_event("org-1", "agent-a", "egress", {"tool": "OUTLOOK_SEND_EMAIL", "target": "inbox"})
    record_event("org-1", "agent-a", "query", {"total_tokens": 1000})

    metrics = build_metrics()

    assert metrics["egress_call_count"] == 2
    assert metrics["egress_ledger"] == [
        {"tool": "OUTLOOK_SEND_EMAIL", "target": "inbox", "count": 2}
    ]
    assert metrics["tokens_processed"] == 1000
    assert metrics["cloud_cost_avoided_usd"] > 0
    assert metrics["tamper_evident_chain_verified"] is True


def test_metrics_flag_a_tampered_chain(monkeypatch, tmp_path):
    _empty_metrics(monkeypatch, tmp_path)
    from agent.audit.log import record_event

    record_event("org-1", "agent-a", "egress", {"tool": "JIRA_CREATE_ISSUE", "target": "PROJ-1"})
    log_path = tmp_path / "events.jsonl"
    record = json.loads(log_path.read_text(encoding="utf-8"))
    record["detail"]["tool"] = "TAMPERED"
    log_path.write_text(json.dumps(record) + "\n", encoding="utf-8")

    metrics = build_metrics()

    assert metrics["tamper_evident_chain_verified"] is False
