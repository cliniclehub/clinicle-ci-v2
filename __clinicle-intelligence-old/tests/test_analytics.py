# encoding:utf-8
"""build_metrics must return well-formed, zeroed aggregates on a fresh install
(empty audit log, no teams, no conversation history) and must correctly
aggregate real records when they exist -- same empty-state/populated-state
split as tests/test_sovereignty.py, since this endpoint reads the same audit
chain plus the team task board and conversation store."""

import json
import time

from channel.web.api.analytics import _autopilot_accuracy, build_metrics


def _empty_metrics(monkeypatch, tmp_path):
    monkeypatch.setattr("agent.audit.log._log_path", lambda: tmp_path / "events.jsonl")
    monkeypatch.setattr("channel.web.api.analytics._daily_query_trend", lambda agent_id, days: [])
    monkeypatch.setattr("agent.workspace.team_store.list_all_tasks", lambda: [])


def test_empty_state_yields_zeroed_metrics(monkeypatch, tmp_path):
    _empty_metrics(monkeypatch, tmp_path)

    metrics = build_metrics()

    assert metrics["query_trend"] == []
    assert metrics["egress_trend"] == []
    assert metrics["egress_by_tool"] == []
    assert metrics["task_completion"] == {"teams": [], "total": 0, "done": 0}
    assert metrics["autopilot_accuracy"] == {"touched": 0, "auto_done": 0, "needs_review": 0}


def test_metrics_aggregate_egress_and_task_records(monkeypatch, tmp_path):
    _empty_metrics(monkeypatch, tmp_path)
    from agent.audit.log import record_event

    record_event("org-1", "agent-a", "egress", {"tool": "OUTLOOK_SEND_EMAIL", "target": "inbox"})
    record_event("org-1", "agent-a", "egress", {"tool": "OUTLOOK_SEND_EMAIL", "target": "inbox"})
    record_event("org-1", "agent-a", "egress", {"tool": "JIRA_CREATE_ISSUE", "target": "PROJ-1"})

    tasks = [
        {"team_id": "t1", "team_name": "Robo", "status": "done"},
        {"team_id": "t1", "team_name": "Robo", "status": "todo"},
        {"team_id": "t2", "team_name": "Content", "status": "done"},
    ]
    monkeypatch.setattr("agent.workspace.team_store.list_all_tasks", lambda: tasks)

    metrics = build_metrics(tenant_id="org-1")

    assert sum(p["count"] for p in metrics["egress_trend"]) == 3
    assert metrics["egress_by_tool"][0] == {"tool": "OUTLOOK_SEND_EMAIL", "count": 2}
    assert metrics["task_completion"]["total"] == 3
    assert metrics["task_completion"]["done"] == 2
    teams_by_id = {t["team_id"]: t for t in metrics["task_completion"]["teams"]}
    assert teams_by_id["t1"] == {"team_id": "t1", "team_name": "Robo", "total": 2, "done": 1}
    assert teams_by_id["t2"] == {"team_id": "t2", "team_name": "Content", "total": 1, "done": 1}


def test_autopilot_accuracy_only_counts_tasks_autopilot_touched(monkeypatch):
    tasks = [
        {"status": "done", "verify_note": "DONE"},
        {"status": "review", "verify_note": "ISSUES: still failing"},
        {"status": "done"},  # no verify_note -- a manual task-board completion, not Autopilot's
    ]
    monkeypatch.setattr("agent.workspace.team_store.list_all_tasks", lambda: tasks)

    result = _autopilot_accuracy()

    assert result == {"touched": 2, "auto_done": 1, "needs_review": 1}


def test_egress_trend_excludes_events_outside_the_window(monkeypatch, tmp_path):
    _empty_metrics(monkeypatch, tmp_path)
    log_path = tmp_path / "events.jsonl"
    old_record = {
        "seq": 1, "ts": time.time() - 30 * 86400, "tenant_id": "org-1", "actor": "a",
        "event_type": "egress", "detail": {"tool": "OLD_TOOL"}, "prev_hash": "0" * 64,
    }
    old_record["hash"] = "irrelevant-for-iter_events"
    log_path.write_text(json.dumps(old_record) + "\n", encoding="utf-8")

    metrics = build_metrics(tenant_id="org-1")

    assert metrics["egress_trend"] == []
    assert metrics["egress_by_tool"] == []
