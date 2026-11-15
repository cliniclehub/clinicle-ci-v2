# encoding:utf-8
"""Guard the tenancy store's isolation primitives.

This is the data layer the whole multi-tenant plan leans on
(~/.claude/plans/typed-pondering-owl.md): orgs, users, and the membership
table that answers "can user X act on org Y" — every other subsystem's tenant
isolation depends on this table being right, so it gets tests before anything
is built on top of it.
"""

import tempfile
from pathlib import Path

import pytest

from agent.tenancy.store import EmailAlreadyRegistered, TenancyStore


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as tmp:
        yield TenancyStore(db_path=Path(tmp) / "platform.db")


def test_create_and_fetch_organization(store):
    org = store.create_organization("Acme Inc")
    assert org.id is not None
    assert org.plan == "free"
    fetched = store.get_organization(org.id)
    assert fetched.name == "Acme Inc"


def test_get_organization_missing_id_returns_none(store):
    # Callers must treat this as a 404, not assume any id handed to them
    # in a request is valid.
    assert store.get_organization(999) is None


def test_create_user_hashes_password_not_plaintext(store):
    user = store.create_user("owner@example.com", "correct horse battery staple")
    assert user.password_hash != "correct horse battery staple"
    assert store.verify_password(user, "correct horse battery staple")
    assert not store.verify_password(user, "wrong password")


def test_duplicate_email_rejected(store):
    store.create_user("dup@example.com", "pw1")
    with pytest.raises(EmailAlreadyRegistered):
        store.create_user("dup@example.com", "pw2")


def test_email_lookup_is_case_insensitive(store):
    store.create_user("Owner@Example.com", "pw")
    assert store.get_user_by_email("owner@example.com") is not None


def test_membership_scopes_user_to_org(store):
    org_a = store.create_organization("Org A")
    org_b = store.create_organization("Org B")
    user = store.create_user("member@example.com", "pw")
    store.add_membership(user.id, org_a.id, role="owner")

    assert store.get_membership(user.id, org_a.id) is not None
    # No membership row for org B — a request scoped to org B for this user
    # must resolve to nothing (the caller's job is to turn that into a 404).
    assert store.get_membership(user.id, org_b.id) is None

    memberships = store.list_memberships_for_user(user.id)
    assert [m.org_id for m in memberships] == [org_a.id]


def test_two_orgs_do_not_leak_into_each_others_membership_list(store):
    org_a = store.create_organization("Org A")
    org_b = store.create_organization("Org B")
    alice = store.create_user("alice@example.com", "pw")
    bob = store.create_user("bob@example.com", "pw")
    store.add_membership(alice.id, org_a.id, role="owner")
    store.add_membership(bob.id, org_b.id, role="owner")

    assert store.get_membership(alice.id, org_b.id) is None
    assert store.get_membership(bob.id, org_a.id) is None


def test_touch_last_login_sets_timestamp(store):
    user = store.create_user("owner@example.com", "pw")
    assert store.get_user(user.id).last_login_at is None
    store.touch_last_login(user.id)
    assert store.get_user(user.id).last_login_at is not None


def test_revoke_all_sessions_sets_cutoff(store):
    user = store.create_user("owner@example.com", "pw")
    assert store.get_user(user.id).sessions_revoked_at is None
    store.revoke_all_sessions(user.id, actor="admin@example.com")
    assert store.get_user(user.id).sessions_revoked_at is not None
