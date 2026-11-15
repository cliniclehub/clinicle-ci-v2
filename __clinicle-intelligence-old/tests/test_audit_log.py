# encoding:utf-8
"""Tamper-evidence guarantee for the append-only audit log (agent/audit/log.py)."""

import json

from agent.audit import log as audit_log


def _use_tmp_log(monkeypatch, tmp_path):
    path = tmp_path / "events.jsonl"
    monkeypatch.setattr(audit_log, "_log_path", lambda: path)
    return path


def test_record_event_chains_hashes(monkeypatch, tmp_path):
    _use_tmp_log(monkeypatch, tmp_path)
    first = audit_log.record_event("org-1", "hania", "secret.stored", {"name": "x"})
    second = audit_log.record_event("org-1", "hania", "secret.deleted", {"name": "x"})

    assert first["seq"] == 1
    assert second["seq"] == 2
    assert second["prev_hash"] == first["hash"]
    assert first["prev_hash"] == "0" * 64


def test_iter_events_filters_by_tenant_and_type(monkeypatch, tmp_path):
    _use_tmp_log(monkeypatch, tmp_path)
    audit_log.record_event("org-1", "a", "secret.stored", {})
    audit_log.record_event("org-2", "b", "secret.stored", {})
    audit_log.record_event("org-1", "a", "secret.deleted", {})

    org1_events = list(audit_log.iter_events(tenant_id="org-1"))
    assert len(org1_events) == 2

    deletes = list(audit_log.iter_events(event_type="secret.deleted"))
    assert len(deletes) == 1
    assert deletes[0]["tenant_id"] == "org-1"


def test_verify_chain_true_for_untouched_log(monkeypatch, tmp_path):
    _use_tmp_log(monkeypatch, tmp_path)
    for i in range(5):
        audit_log.record_event("org-1", "hania", "tool.invoked", {"i": i})
    assert audit_log.verify_chain() is True


def test_verify_chain_true_for_empty_log(monkeypatch, tmp_path):
    _use_tmp_log(monkeypatch, tmp_path)
    assert audit_log.verify_chain() is True


def test_verify_chain_detects_content_tamper(monkeypatch, tmp_path):
    path = _use_tmp_log(monkeypatch, tmp_path)
    audit_log.record_event("org-1", "hania", "secret.stored", {"name": "stripe_key"})
    audit_log.record_event("org-1", "hania", "secret.deleted", {"name": "stripe_key"})

    lines = path.read_text().splitlines()
    tampered = json.loads(lines[0])
    tampered["detail"]["name"] = "stolen"  # hash not recomputed -> chain breaks
    lines[0] = json.dumps(tampered)
    path.write_text("\n".join(lines) + "\n")

    assert audit_log.verify_chain() is False


def test_verify_chain_detects_deleted_record(monkeypatch, tmp_path):
    path = _use_tmp_log(monkeypatch, tmp_path)
    audit_log.record_event("org-1", "hania", "a", {})
    audit_log.record_event("org-1", "hania", "b", {})
    audit_log.record_event("org-1", "hania", "c", {})

    lines = path.read_text().splitlines()
    del lines[1]  # remove the middle record entirely
    path.write_text("\n".join(lines) + "\n")

    assert audit_log.verify_chain() is False
