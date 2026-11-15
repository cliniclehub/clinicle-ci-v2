# encoding:utf-8
"""Guard the multi-tenant session token: it must not be forgeable, must not
be confusable with the legacy password-signed token, and must expire."""

import time

import pytest

from channel.web.core import tenancy_session


@pytest.fixture(autouse=True)
def isolated_secret(tmp_path, monkeypatch):
    monkeypatch.setattr(
        tenancy_session, "_secret_path", lambda: tmp_path / "session_secret"
    )
    yield


def test_round_trip():
    token = tenancy_session.create_session_token(user_id=1, org_id=2, expire_seconds=3600)
    assert tenancy_session.verify_session_token(token, expire_seconds=3600) == (1, 2)


def test_tampered_token_rejected():
    token = tenancy_session.create_session_token(user_id=1, org_id=2, expire_seconds=3600)
    tampered = token.replace(".2.", ".3.", 1)  # swap org_id in the payload
    assert tenancy_session.verify_session_token(tampered, expire_seconds=3600) is None


def test_expired_token_rejected(monkeypatch):
    token = tenancy_session.create_session_token(user_id=1, org_id=2, expire_seconds=3600)
    future = time.time() + 7200
    monkeypatch.setattr(time, "time", lambda: future)
    assert tenancy_session.verify_session_token(token, expire_seconds=3600) is None


def test_malformed_token_rejected():
    assert tenancy_session.verify_session_token("not-a-token", expire_seconds=3600) is None
    assert tenancy_session.verify_session_token("", expire_seconds=3600) is None


def test_two_users_get_different_tokens():
    token_a = tenancy_session.create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    token_b = tenancy_session.create_session_token(user_id=2, org_id=1, expire_seconds=3600)
    assert token_a != token_b
    assert tenancy_session.verify_session_token(token_a, expire_seconds=3600) == (1, 1)
    assert tenancy_session.verify_session_token(token_b, expire_seconds=3600) == (2, 1)


@pytest.fixture
def store(tmp_path):
    from agent.tenancy.store import TenancyStore
    return TenancyStore(db_path=tmp_path / "platform.db")


def test_active_verify_rejects_token_for_missing_user(monkeypatch, store):
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)
    token = tenancy_session.create_session_token(user_id=999, org_id=1, expire_seconds=3600)
    assert tenancy_session.verify_session_token_active(token, expire_seconds=3600) is None


def test_active_verify_accepts_token_for_real_unrevoked_user(monkeypatch, store):
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)
    user = store.create_user("owner@example.com", "pw")
    org = store.create_organization("Acme")
    token = tenancy_session.create_session_token(user_id=user.id, org_id=org.id, expire_seconds=3600)
    assert tenancy_session.verify_session_token_active(token, expire_seconds=3600) == (user.id, org.id)


def test_active_verify_rejects_token_issued_before_revocation(monkeypatch, store):
    # Both the token's issue time and the revoke cutoff are second-resolution
    # (ts_hex / int(time.time())), so this drives the clock explicitly rather
    # than relying on two real calls landing in different wall-clock seconds
    # -- otherwise the test is flaky by one second's margin.
    monkeypatch.setattr("agent.tenancy.store.get_tenancy_store", lambda: store)
    user = store.create_user("owner@example.com", "pw")
    org = store.create_organization("Acme")

    monkeypatch.setattr(time, "time", lambda: 1_000_000)
    token = tenancy_session.create_session_token(user_id=user.id, org_id=org.id, expire_seconds=3600)
    assert tenancy_session.verify_session_token_active(token, expire_seconds=3600) == (user.id, org.id)

    monkeypatch.setattr(time, "time", lambda: 1_000_010)
    store.revoke_all_sessions(user.id, actor="admin@example.com")
    assert tenancy_session.verify_session_token_active(token, expire_seconds=3600) is None

    # A freshly issued token, minted after the revocation, verifies fine --
    # only tokens issued before the cutoff are rejected.
    monkeypatch.setattr(time, "time", lambda: 1_000_020)
    new_token = tenancy_session.create_session_token(user_id=user.id, org_id=org.id, expire_seconds=3600)
    assert tenancy_session.verify_session_token_active(new_token, expire_seconds=3600) == (user.id, org.id)
