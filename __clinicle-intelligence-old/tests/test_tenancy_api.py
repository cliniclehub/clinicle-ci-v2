# encoding:utf-8
"""channel/web/api/tenancy.py: the HTTP surface over agent/tenancy/store.py's
membership functions, which had no endpoint before this module.

Every write here (role change, removal) must reject a non-admin caller before
touching the store -- that is the property these tests exist to pin down.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
import web

from agent.tenancy.store import TenancyStore


@pytest.fixture
def store(tmp_path):
    return TenancyStore(db_path=Path(tmp_path) / "platform.db")


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    # web.HTTPError writes a Content-Type header, which needs a request
    # context; give it the minimum one it touches (same fix as
    # test_wechatcomapp_callback_verify.py).
    web.ctx.headers = []


@pytest.fixture
def org_with_admin_and_member(store):
    org = store.create_organization("Acme")
    admin = store.create_user("admin@example.com", "password123")
    member = store.create_user("member@example.com", "password123")
    store.add_membership(admin.id, org.id, role="admin", actor="admin@example.com")
    store.add_membership(member.id, org.id, role="member", actor="admin@example.com")
    return org, admin, member


def _patched(store, acting_user_id, org_id):
    return (
        patch("channel.web.api.tenancy.web.header"),
        patch("channel.web.api.tenancy.get_tenancy_store", return_value=store),
        patch("channel.web.api.tenancy._current_user_and_org", return_value=(acting_user_id, org_id)),
    )


def test_list_members_includes_role_and_mfa_status(store, org_with_admin_and_member):
    org, admin, member = org_with_admin_and_member
    from channel.web.api.tenancy import OrgMembersHandler

    p1, p2, p3 = _patched(store, admin.id, org.id)
    with p1, p2, p3:
        response = json.loads(OrgMembersHandler().GET())

    assert response["status"] == "success"
    by_email = {m["email"]: m for m in response["members"]}
    assert by_email["admin@example.com"]["role"] == "admin"
    assert by_email["admin@example.com"]["is_self"] is True
    assert by_email["member@example.com"]["role"] == "member"
    assert by_email["member@example.com"]["mfa_enabled"] is False


def test_non_admin_cannot_change_a_role(store, org_with_admin_and_member):
    org, admin, member = org_with_admin_and_member
    from channel.web.api.tenancy import OrgMemberRoleHandler

    p1, p2, p3 = _patched(store, member.id, org.id)  # acting as the plain member
    with p1, p2, p3, \
         patch("channel.web.api.tenancy.web.data", return_value=json.dumps({"role": "admin"}).encode()):
        with pytest.raises(Exception) as exc_info:
            OrgMemberRoleHandler().POST(str(admin.id))

    assert "403" in str(exc_info.value)
    # The store must reflect no change -- the rejection has to happen before
    # any write, not just in the HTTP response.
    assert store.get_membership(admin.id, org.id).role == "admin"


def test_non_admin_cannot_remove_a_member(store, org_with_admin_and_member):
    org, admin, member = org_with_admin_and_member
    from channel.web.api.tenancy import OrgMemberHandler

    p1, p2, p3 = _patched(store, member.id, org.id)  # acting as the plain member
    with p1, p2, p3:
        with pytest.raises(Exception) as exc_info:
            OrgMemberHandler().DELETE(str(admin.id))

    assert "403" in str(exc_info.value)
    assert store.get_membership(admin.id, org.id) is not None


def test_admin_can_change_a_members_role(store, org_with_admin_and_member):
    org, admin, member = org_with_admin_and_member
    from channel.web.api.tenancy import OrgMemberRoleHandler

    p1, p2, p3 = _patched(store, admin.id, org.id)
    with p1, p2, p3, \
         patch("channel.web.api.tenancy.web.data", return_value=json.dumps({"role": "admin"}).encode()):
        response = json.loads(OrgMemberRoleHandler().POST(str(member.id)))

    assert response["status"] == "success"
    assert store.get_membership(member.id, org.id).role == "admin"


def test_admin_can_remove_a_member(store, org_with_admin_and_member):
    org, admin, member = org_with_admin_and_member
    from channel.web.api.tenancy import OrgMemberHandler

    p1, p2, p3 = _patched(store, admin.id, org.id)
    with p1, p2, p3:
        response = json.loads(OrgMemberHandler().DELETE(str(member.id)))

    assert response["status"] == "success"
    assert store.get_membership(member.id, org.id) is None


def test_cannot_remove_yourself(store, org_with_admin_and_member):
    org, admin, member = org_with_admin_and_member
    from channel.web.api.tenancy import OrgMemberHandler

    p1, p2, p3 = _patched(store, admin.id, org.id)
    with p1, p2, p3:
        response = json.loads(OrgMemberHandler().DELETE(str(admin.id)))

    assert response["status"] == "error"
    assert store.get_membership(admin.id, org.id) is not None


def test_member_from_a_different_org_is_not_found_not_leaked(store, org_with_admin_and_member):
    """A foreign org's user id must 404, not silently succeed or 200 with
    someone else's data -- the IDOR case get_membership() exists to prevent."""
    org, admin, member = org_with_admin_and_member
    other_org = store.create_organization("Other Co")
    outsider = store.create_user("outsider@example.com", "password123")
    store.add_membership(outsider.id, other_org.id, role="owner", actor="outsider@example.com")

    from channel.web.api.tenancy import OrgMemberHandler

    p1, p2, p3 = _patched(store, admin.id, org.id)
    with p1, p2, p3:
        with pytest.raises(Exception) as exc_info:
            OrgMemberHandler().DELETE(str(outsider.id))

    assert "404" in str(exc_info.value)
