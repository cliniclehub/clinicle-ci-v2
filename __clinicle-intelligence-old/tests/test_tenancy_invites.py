# encoding:utf-8
"""Guard the invite lifecycle: no email-sending infrastructure exists in this
codebase, so an invite is a one-time signed link an admin sends manually
(see agent/tenancy/store.py's create_invite docstring) -- these tests are
the only thing enforcing that a token is single-use, expires, normalizes
email case, and never lets a second org's invite duplicate an existing
account.
"""

import tempfile
import time
from pathlib import Path

import pytest

from agent.tenancy.store import InviteExpired, TenancyStore


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as tmp:
        yield TenancyStore(db_path=Path(tmp) / "platform.db")


@pytest.fixture
def org(store):
    return store.create_organization("Acme Inc")


def test_invite_email_normalized_to_lowercase(store, org):
    invite = store.create_invite(org.id, "New.Person@ACME.com", role="member")
    assert invite.email == "new.person@acme.com"


def test_create_invite_rejects_unknown_role(store, org):
    with pytest.raises(ValueError):
        store.create_invite(org.id, "x@acme.com", role="superadmin")


def test_accept_invite_creates_account_and_membership(store, org):
    invite = store.create_invite(org.id, "new@acme.com", role="admin", invited_by="owner@acme.com")

    user, membership = store.accept_invite(invite.token, "a-real-password")

    assert user.email == "new@acme.com"
    assert membership.role == "admin"
    assert store.has_role(user.id, org.id, "admin")


def test_invite_is_single_use(store, org):
    invite = store.create_invite(org.id, "once@acme.com")
    store.accept_invite(invite.token, "password123")

    assert store.get_invite(invite.token) is None
    with pytest.raises(ValueError, match="not found"):
        store.accept_invite(invite.token, "password123")


def test_expired_invite_is_rejected_and_cleaned_up(store, org):
    invite = store.create_invite(org.id, "late@acme.com")
    # Backdate expiry directly -- no public API mutates it, this simulates
    # the passage of the 7-day TTL.
    conn = store._connect()
    conn.execute("UPDATE invites SET expires_at = ? WHERE token = ?",
                 (int(time.time()) - 1, invite.token))
    conn.commit()
    conn.close()

    with pytest.raises(InviteExpired):
        store.accept_invite(invite.token, "password123")
    assert store.get_invite(invite.token) is None  # expired invite is consumed, not left dangling


def test_accepting_invite_for_existing_email_reuses_the_account(store, org):
    first_org = store.create_organization("First Org")
    first_invite = store.create_invite(first_org.id, "shared@acme.com")
    user, _ = store.accept_invite(first_invite.token, "original-password")

    second_invite = store.create_invite(org.id, "shared@acme.com", role="admin")
    user2, membership2 = store.accept_invite(second_invite.token, "ignored-password")

    assert user2.id == user.id  # same account, not duplicated
    assert store.has_role(user.id, org.id, "admin")
    # The original account's password is untouched by the second accept.
    assert store.verify_password(user, "original-password")


def test_delete_invite_revokes_it(store, org):
    invite = store.create_invite(org.id, "revoke-me@acme.com")
    store.delete_invite(invite.token)
    assert store.get_invite(invite.token) is None


def test_list_invites_for_org_excludes_other_orgs(store, org):
    other_org = store.create_organization("Other Org")
    store.create_invite(org.id, "a@acme.com")
    store.create_invite(other_org.id, "b@other.com")

    invites = store.list_invites_for_org(org.id)
    assert len(invites) == 1
    assert invites[0].email == "a@acme.com"
