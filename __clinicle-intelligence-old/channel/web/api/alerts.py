"""The Alerts feed: /api/alerts/*.

Reads the same tamper-evident audit chain the Sovereignty dashboard reads
(``agent.audit.log``) and reclassifies genuinely alert-worthy events into a
severity-ranked feed. Deliberately narrower than the audit log itself:
high-volume routine events ("egress", "query") are the Sovereignty page's
job (its ledger/token counters), not this page's -- surfacing every egress
call here would bury the handful of events an operator actually needs to
react to.

Severity mapping (judgment call, documented here since there is no other
source of truth for it):
  - critical: the tamper-evident chain itself no longer verifies -- the
    audit log may have been edited/reordered after the fact.
  - high: a failed login attempt, a denied compliance action (a non-owner
    tried to export/purge tenant data), or a background task that failed
    (scheduled task or autopilot run).
  - medium: an action that changes who can do what or removes something --
    role change, secret deletion, MFA turned off, a tenant data export.
  - info: routine but worth a record -- account created, secret stored,
    MFA turned on, successful login.

Excluded entirely as too noisy for an "alert" (see agent/audit/log.py call
sites for the full event-type census):
  - "egress" / "query": one row per tool call / LLM turn -- that's what the
    Sovereignty page's egress ledger and token counters already cover.
  - "mfa.enroll_started": an in-progress step, not a completed action; only
    the terminal "mfa.enabled" is meaningful.
  - "retention.purge_ran" / "backup.created": routine, expected background
    maintenance, not signals an operator needs to act on.
"""

import json

import web

from channel.web.core._common import _request_agent_id, _require_auth
from common.log import logger

# event_type -> (severity, human-readable description template).
# ``detail`` fields referenced in the template are filled in per-record;
# a template referencing a missing field just leaves it blank.
_EVENT_RULES = {
    "user.login_failed": ("high", "Failed login attempt ({reason})"),
    "task_failed": ("high", "Background task failed: {subject_or_task}"),
    "compliance.denied": ("high", "Permission denied: user {user_id} is not an owner of org {org_id}"),
    "compliance.purged": ("high", "Tenant data purged (org {tenant_id})"),
    "mfa.disabled": ("medium", "MFA disabled for user {user_id}"),
    "membership.role_set": ("medium", "Role set to '{role}' for user {user_id}"),
    "secret.deleted": ("medium", "Secret deleted: {name}"),
    "compliance.export": ("medium", "Tenant data exported (org {tenant_id})"),
    "user.created": ("info", "New account created"),
    "user.login": ("info", "Successful login"),
    "secret.stored": ("info", "Secret stored: {name}"),
    "mfa.enabled": ("info", "MFA enabled for user {user_id}"),
    "review_queue.flag_raised": ("medium", "{title} (category: {category})"),
}

_SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "info": 3}


def _describe(event_type: str, detail: dict) -> str:
    _, template = _EVENT_RULES[event_type]
    filled = dict(detail or {})
    filled.setdefault("subject_or_task", detail.get("subject") or detail.get("task_id") or "unknown")
    try:
        return template.format(**filled)
    except (KeyError, IndexError):
        return template


def build_alerts(tenant_id=None) -> list:
    from agent.audit.log import iter_events, verify_chain

    alerts = []
    for record in iter_events(tenant_id=tenant_id):
        event_type = record.get("event_type")
        rule = _EVENT_RULES.get(event_type)
        if not rule:
            continue
        severity, _ = rule
        detail = record.get("detail") or {}
        alerts.append({
            "seq": record.get("seq"),
            "ts": record.get("ts"),
            "actor": record.get("actor"),
            "event_type": event_type,
            "severity": severity,
            "description": _describe(event_type, detail),
            "detail": detail,
        })

    if not verify_chain(tenant_id):
        alerts.append({
            "seq": None,
            "ts": None,
            "actor": "system",
            "event_type": "chain_broken",
            "severity": "critical",
            "description": "Tamper-evident audit chain no longer verifies -- a record may have been edited, deleted, or reordered",
            "detail": {},
        })

    alerts.sort(key=lambda a: (a["ts"] is None, -(a["ts"] or 0)))
    return alerts


class AlertsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from common.runtime_identity import current_identity

            params = web.input(agent_id='')
            _request_agent_id(params)
            alerts = build_alerts(current_identity().org_id)
            counts = {"critical": 0, "high": 0, "medium": 0, "info": 0}
            for a in alerts:
                counts[a["severity"]] = counts.get(a["severity"], 0) + 1
            return json.dumps({"status": "success", "alerts": alerts, "counts": counts}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[Alerts] fetch failed: {e}")
            return json.dumps({"status": "error", "message": "Could not build alerts feed"})
