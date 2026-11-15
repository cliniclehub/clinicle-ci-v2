# encoding:utf-8
"""MFA (TOTP) and role-enforcement additions to agent/tenancy/store.py."""

import pyotp
import pytest

from agent.audit import log as audit_log
from agent.tenancy.store import ROLE_RANK, TenancyStore


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "_log_path", lambda: tmp_path / "events.jsonl")
    return TenancyStore(db_path=tmp_path / "platform.db")


@pytest.fixture
def user_and_org(store):
    user = store.create_user("hania@example.com", "password123")
    org = store.create_organization("Acme")
    store.add_membership(user.id, org.id, role="owner", actor="hania@example.com")
    return user, org


# -- MFA ----------------------------------------------------------------


def test_enroll_leaves_mfa_disabled_until_confirmed(store, user_and_org):
    user, org = user_and_org
    store.enroll_mfa(user.id, actor="hania@example.com")
    assert store.get_user(user.id).mfa_enabled is False


def test_confirm_with_valid_code_enables_mfa(store, user_and_org):
    user, org = user_and_org
    secret = store.enroll_mfa(user.id, actor="hania@example.com")
    code = pyotp.TOTP(secret).now()

    assert store.confirm_mfa(user.id, code, actor="hania@example.com") is True
    assert store.get_user(user.id).mfa_enabled is True


def test_confirm_with_wrong_code_does_not_enable(store, user_and_org):
    user, org = user_and_org
    store.enroll_mfa(user.id, actor="hania@example.com")
    assert store.confirm_mfa(user.id, "000000", actor="hania@example.com") is False
    assert store.get_user(user.id).mfa_enabled is False


def test_verify_mfa_code_at_login(store, user_and_org):
    user, org = user_and_org
    secret = store.enroll_mfa(user.id, actor="hania@example.com")
    store.confirm_mfa(user.id, pyotp.TOTP(secret).now(), actor="hania@example.com")
    live_user = store.get_user(user.id)

    assert store.verify_mfa_code(live_user, pyotp.TOTP(secret).now()) is True
    assert store.verify_mfa_code(live_user, "000000") is False


def test_verify_mfa_code_false_when_mfa_off(store, user_and_org):
    user, org = user_and_org
    assert store.verify_mfa_code(store.get_user(user.id), "123456") is False


def test_disable_mfa_clears_secret(store, user_and_org):
    user, org = user_and_org
    secret = store.enroll_mfa(user.id, actor="hania@example.com")
    store.confirm_mfa(user.id, pyotp.TOTP(secret).now(), actor="hania@example.com")

    store.disable_mfa(user.id, actor="hania@example.com")
    live_user = store.get_user(user.id)
    assert live_user.mfa_enabled is False
    assert live_user.mfa_secret is None


def test_mfa_actions_are_audit_logged(store, user_and_org):
    user, org = user_and_org
    secret = store.enroll_mfa(user.id, actor="hania@example.com")
    store.confirm_mfa(user.id, pyotp.TOTP(secret).now(), actor="hania@example.com")
    store.disable_mfa(user.id, actor="hania@example.com")

    event_types = [e["event_type"] for e in audit_log.iter_events()]
    assert "mfa.enroll_started" in event_types
    assert "mfa.enabled" in event_types
    assert "mfa.disabled" in event_types


# -- RBAC -----------------------------------------------------------------


def test_role_rank_is_ordered():
    assert ROLE_RANK["member"] < ROLE_RANK["admin"] < ROLE_RANK["owner"]


def test_has_role_true_for_exact_and_lower_bar(store, user_and_org):
    user, org = user_and_org  # owner
    assert store.has_role(user.id, org.id, "owner") is True
    assert store.has_role(user.id, org.id, "admin") is True
    assert store.has_role(user.id, org.id, "member") is True


def test_has_role_false_when_role_too_low(store):
    user = store.create_user("member@example.com", "password123")
    org = store.create_organization("Acme")
    store.add_membership(user.id, org.id, role="member", actor="member@example.com")

    assert store.has_role(user.id, org.id, "admin") is False
    assert store.has_role(user.id, org.id, "owner") is False
    assert store.has_role(user.id, org.id, "member") is True


def test_has_role_false_for_nonmember_or_wrong_org(store, user_and_org):
    user, org = user_and_org
    other_org = store.create_organization("Other Co")
    # Same user, no membership in other_org: must deny, not fall through.
    assert store.has_role(user.id, other_org.id, "member") is False
    # Nonexistent user id.
    assert store.has_role(user.id + 999, org.id, "member") is False


def test_add_membership_rejects_unknown_role(store):
    user = store.create_user("x@example.com", "password123")
    org = store.create_organization("Acme")
    with pytest.raises(ValueError):
        store.add_membership(user.id, org.id, role="superadmin")


def test_role_changes_are_audit_logged(store):
    user = store.create_user("x@example.com", "password123")
    org = store.create_organization("Acme")
    store.add_membership(user.id, org.id, role="admin", actor="hania@example.com")

    events = [e for e in audit_log.iter_events(event_type="membership.role_set")]
    assert len(events) == 1
    assert events[0]["detail"] == {"user_id": user.id, "org_id": org.id, "role": "admin"}
    assert events[0]["actor"] == "hania@example.com"
