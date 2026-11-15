# encoding:utf-8
"""Encryption-at-rest and audit-trail guarantees for agent/security/secrets_vault.py."""

import pytest

from agent.audit import log as audit_log
from agent.security.secrets_vault import SecretNotFound, SecretsVault


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "_log_path", lambda: tmp_path / "events.jsonl")
    return SecretsVault(db_path=tmp_path / "vault.db", key_path=tmp_path / "key")


def test_store_then_get_round_trips(vault):
    vault.store_secret("org-1", "stripe_key", "sk_live_abc123")
    assert vault.get_secret("org-1", "stripe_key") == "sk_live_abc123"


def test_plaintext_never_hits_disk(vault, tmp_path):
    vault.store_secret("org-1", "stripe_key", "sk_live_super_secret_value")
    raw = (tmp_path / "vault.db").read_bytes()
    assert b"sk_live_super_secret_value" not in raw


def test_list_secret_names_never_returns_values(vault):
    vault.store_secret("org-1", "stripe_key", "sk_live_abc123")
    vault.store_secret("org-1", "openai_key", "sk-openai-xyz")
    names = vault.list_secret_names("org-1")
    assert sorted(names) == ["openai_key", "stripe_key"]
    assert "sk_live_abc123" not in names
    assert "sk-openai-xyz" not in names


def test_secrets_are_isolated_per_tenant(vault):
    vault.store_secret("org-1", "api_key", "value-for-org-1")
    vault.store_secret("org-2", "api_key", "value-for-org-2")
    assert vault.get_secret("org-1", "api_key") == "value-for-org-1"
    assert vault.get_secret("org-2", "api_key") == "value-for-org-2"
    assert vault.list_secret_names("org-1") == ["api_key"]


def test_get_missing_secret_raises(vault):
    with pytest.raises(SecretNotFound):
        vault.get_secret("org-1", "nope")


def test_delete_secret_removes_it(vault):
    vault.store_secret("org-1", "api_key", "value")
    assert vault.delete_secret("org-1", "api_key") is True
    assert vault.list_secret_names("org-1") == []
    assert vault.delete_secret("org-1", "api_key") is False  # already gone


def test_store_and_delete_are_audit_logged(vault):
    vault.store_secret("org-1", "api_key", "value", actor="hania")
    vault.delete_secret("org-1", "api_key", actor="hania")

    events = list(audit_log.iter_events(tenant_id="org-1"))
    event_types = [e["event_type"] for e in events]
    assert event_types == ["secret.stored", "secret.deleted"]
    for e in events:
        assert e["actor"] == "hania"
        # Detail carries the secret's name, never its value.
        assert e["detail"] == {"name": "api_key"}


def test_get_and_list_are_not_audit_logged(vault):
    vault.store_secret("org-1", "api_key", "value")
    vault.get_secret("org-1", "api_key")
    vault.list_secret_names("org-1")

    events = list(audit_log.iter_events(tenant_id="org-1"))
    assert len(events) == 1  # only the store, not the reads
    assert events[0]["event_type"] == "secret.stored"


def test_key_is_persisted_across_instances(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "_log_path", lambda: tmp_path / "events.jsonl")
    db_path = tmp_path / "vault.db"
    key_path = tmp_path / "key"

    vault_a = SecretsVault(db_path=db_path, key_path=key_path)
    vault_a.store_secret("org-1", "api_key", "value")

    # A fresh instance reusing the same key file must decrypt what the first wrote.
    vault_b = SecretsVault(db_path=db_path, key_path=key_path)
    assert vault_b.get_secret("org-1", "api_key") == "value"
