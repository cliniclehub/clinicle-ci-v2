"""Org membership management: list members, change a member's role, remove a
member -- scoped to the acting user's own org via the same multi-tenant
session token ``auth.py``'s handlers already use.

``agent/tenancy/store.py`` has had this data (list_memberships_for_org,
has_role, delete_membership, ...) with no HTTP wrapper until now. MFA
enroll/confirm/disable already exist in ``auth.py``; the frontend calls those
endpoints directly rather than duplicating them here.
"""

import json

import web

from agent.tenancy.store import ROLE_RANK, get_tenancy_store
from channel.web.api.user_avatar import user_avatar_rev
from channel.web.core._common import (
    _get_bearer_token, _get_query_token, _require_capability, _session_expire_seconds,
)


def _current_user_and_org():
    """(user_id, org_id) from the multi-tenant session token, or (None, None).

    Same three token sources and same verify_session_token() call as
    auth.py's ``_current_user_id`` -- this is the one tenant-scoping
    mechanism the codebase has, not a second check invented for this module.
    """
    from channel.web.core.tenancy_session import verify_session_token_active

    for token in (web.cookies().get("cow_auth_token", ""), _get_bearer_token(), _get_query_token()):
        if not token:
            continue
        identity = verify_session_token_active(token, _session_expire_seconds())
        if identity is not None:
            return identity
    return None, None


def _error(status: str, message: str):
    return web.HTTPError(status, {"Content-Type": "application/json; charset=utf-8"},
                          json.dumps({"status": "error", "message": message}))


def _require_membership(min_role: str = "member", capability: str = None):
    """401 if not signed in to a real org account, 403 if below ``min_role``
    in that org. Returns (user_id, org_id) -- callers scope every store call
    to this org_id, never one taken from the request.

    ``capability`` layers a Settings-area capability check (see
    agent/permission/capabilities.py) on top of the role check -- role is
    the floor (e.g. "must be admin+"), capability is an org's own further
    restriction on top of that floor. Omit it for endpoints that must never
    be capability-gated, notably anything that edits the capability matrix
    itself (would let an org lock its own admins out) or reads the caller's
    own resolved capabilities (circular)."""
    user_id, org_id = _current_user_and_org()
    if user_id is None:
        raise _error("401 Unauthorized", "Unauthorized")
    store = get_tenancy_store()
    if not store.has_role(user_id, org_id, min_role):
        raise _error("403 Forbidden", f"{min_role} role required")
    if capability is not None:
        _require_capability(capability)
    return user_id, org_id


class OrgMembersHandler:
    """GET /api/org/members -- every member of the caller's own org.

    Legacy single-password installs (``has_any_user()`` false -- the same
    fork point every other admin page checks, e.g. ``secrets.py``'s
    ``_require_secrets_admin``) have no org/membership concept at all, so
    this returns an empty, ``applicable: false`` list rather than
    ``_require_membership``'s hard 401 -- a page-load GET 401ing kicks the
    *entire* app to the login screen (see ``core/auth.js``'s global fetch
    interceptor), which is wrong when the user is already correctly
    authenticated via the legacy shared password."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        if not get_tenancy_store().has_any_user():
            return json.dumps({"status": "success", "members": [], "applicable": False})
        user_id, org_id = _require_membership("member", capability="settings.users")

        store = get_tenancy_store()
        members = []
        for m in store.list_memberships_for_org(org_id):
            u = store.get_user(m.user_id)
            if u is None:
                continue
            members.append({
                "id": u.id, "email": u.email, "role": m.role,
                "mfa_enabled": u.mfa_enabled, "is_self": u.id == user_id,
                "avatar_rev": user_avatar_rev(u.id),
            })
        members.sort(key=lambda x: (-ROLE_RANK.get(x["role"], -1), x["email"]))
        return json.dumps({"status": "success", "members": members})


class OrgMemberRoleHandler:
    """POST /api/org/members/<id>/role {"role": "admin"} -- admin+ only."""

    def POST(self, member_id):
        web.header('Content-Type', 'application/json; charset=utf-8')
        acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        try:
            target_user_id = int(member_id)
        except ValueError:
            raise _error("404 Not Found", "Not found")

        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        role = str(data.get("role", "") or "")
        if role not in ROLE_RANK:
            return json.dumps({"status": "error", "message": f"Unknown role: {role}"})

        store = get_tenancy_store()
        if store.get_membership(target_user_id, org_id) is None:
            raise _error("404 Not Found", "Not found")

        actor = store.get_user(acting_user_id)
        store.add_membership(target_user_id, org_id, role=role, actor=actor.email if actor else None)
        return json.dumps({"status": "success"})


class OrgMemberHandler:
    """DELETE /api/org/members/<id> -- remove a member, admin+ only."""

    def DELETE(self, member_id):
        web.header('Content-Type', 'application/json; charset=utf-8')
        acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        try:
            target_user_id = int(member_id)
        except ValueError:
            raise _error("404 Not Found", "Not found")
        if target_user_id == acting_user_id:
            return json.dumps({"status": "error", "message": "Cannot remove yourself"})

        store = get_tenancy_store()
        if store.get_membership(target_user_id, org_id) is None:
            raise _error("404 Not Found", "Not found")
        store.delete_membership(target_user_id, org_id)
        return json.dumps({"status": "success"})


class OrgInvitesHandler:
    """GET /api/org/invites -- pending invites for the caller's org, admin+.
    POST /api/org/invites {"email","role"} -- mints one, admin+. No email is
    sent (no such infrastructure exists here) -- the response's ``accept_url``
    is what the admin copies and sends the invitee themselves.

    GET has the same legacy-install fallback as ``OrgMembersHandler.GET``
    (see its docstring) -- it's fetched unconditionally on every Agents &
    Org page load, so a hard 401 there kicks the whole app to the login
    screen on an install with no accounts yet."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        if not get_tenancy_store().has_any_user():
            return json.dumps({"status": "success", "invites": [], "applicable": False})
        _acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        store = get_tenancy_store()
        invites = [
            {"token": i.token, "email": i.email, "role": i.role,
             "invited_by": i.invited_by, "created_at": i.created_at, "expires_at": i.expires_at}
            for i in store.list_invites_for_org(org_id)
        ]
        return json.dumps({"status": "success", "invites": invites})

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        email = str(data.get("email", "") or "").strip()
        role = str(data.get("role", "") or "member")
        if not email or "@" not in email:
            return json.dumps({"status": "error", "message": "A valid email is required"})
        if role not in ROLE_RANK:
            return json.dumps({"status": "error", "message": f"Unknown role: {role}"})

        store = get_tenancy_store()
        actor = store.get_user(acting_user_id)
        invite = store.create_invite(org_id, email, role=role, invited_by=actor.email if actor else None)
        accept_url = f"{web.ctx.home}/invite/{invite.token}"
        return json.dumps({"status": "success", "invite": {
            "token": invite.token, "email": invite.email, "role": invite.role, "accept_url": accept_url,
        }})


class OrgInviteHandler:
    """DELETE /api/org/invites/<token> -- revoke a pending invite, admin+."""

    def DELETE(self, token):
        web.header('Content-Type', 'application/json; charset=utf-8')
        _acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        store = get_tenancy_store()
        invite = store.get_invite(token)
        if invite is None or invite.org_id != org_id:
            raise _error("404 Not Found", "Not found")
        store.delete_invite(token)
        return json.dumps({"status": "success"})


class MyCapabilitiesHandler:
    """GET /api/me/capabilities -- the caller's OWN resolved capability set
    (not the editable matrix -- that's OrgCapabilitiesHandler, admin+ only).
    Fetched once per session load by the frontend to gate sidebar/Settings
    nav items client-side. Legacy no-account installs get every capability
    (there's no membership/role concept to deny anything against)."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        from agent.permission.capabilities import CAPABILITY_KEYS

        if not get_tenancy_store().has_any_user():
            return json.dumps({"status": "success", "capabilities": sorted(CAPABILITY_KEYS),
                                "role": None, "applicable": False})
        user_id, org_id = _current_user_and_org()
        if user_id is None:
            raise _error("401 Unauthorized", "Unauthorized")
        store = get_tenancy_store()
        membership = store.get_membership(user_id, org_id)
        if membership is None:
            raise _error("401 Unauthorized", "Unauthorized")
        granted = [c for c in CAPABILITY_KEYS if store.has_capability(user_id, org_id, c)]
        return json.dumps({"status": "success", "capabilities": sorted(granted), "role": membership.role})


class OrgAuditHandler:
    """GET /api/org/audit?actor=<email>&limit=<n> -- recent audit-log events
    for the caller's org, admin+ only. Backed by agent/audit/log.py's
    existing tamper-evident JSONL store, unexposed over HTTP until now.

    Matches on tenant_id == this org OR actor is a current member's email:
    several event types (user.created, mfa.*) predate any org membership and
    are recorded with tenant_id=None, so a tenant_id-only filter would drop
    them even though they're clearly this org's member's own events."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        from agent.audit import log as audit_log

        if not get_tenancy_store().has_any_user():
            return json.dumps({"status": "success", "events": [], "applicable": False})
        _acting_user_id, org_id = _require_membership("admin", capability="settings.users")
        store = get_tenancy_store()
        member_emails = {
            u.email for u in (store.get_user(m.user_id) for m in store.list_memberships_for_org(org_id))
            if u is not None
        }
        actor_filter = (web.input(actor="").actor or "").strip().lower() or None
        try:
            limit = max(1, min(int(web.input(limit="100").limit), 500))
        except ValueError:
            limit = 100

        matched = []
        for event in audit_log.iter_events():
            if event.get("tenant_id") != str(org_id) and event.get("actor") not in member_emails:
                continue
            if actor_filter and event.get("actor") != actor_filter:
                continue
            matched.append(event)
        matched.sort(key=lambda e: e.get("seq", 0), reverse=True)
        events = [
            {"seq": e.get("seq"), "ts": e.get("ts"), "actor": e.get("actor"),
             "event_type": e.get("event_type"), "detail": e.get("detail")}
            for e in matched[:limit]
        ]
        return json.dumps({"status": "success", "events": events})


class OrgCapabilitiesHandler:
    """GET /api/org/capabilities -- the caller's org's admin/member capability
    matrix (Settings > Permissions), admin+ only to view since it exposes
    what members can/can't do org-wide.
    POST /api/org/capabilities {"role","capability","granted"} -- edit one
    cell, admin+ only. Owner is never editable (see
    TenancyStore.has_capability -- owner always passes regardless)."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        from agent.permission.capabilities import CAPABILITIES

        if not get_tenancy_store().has_any_user():
            return json.dumps({"status": "success", "capabilities": [], "matrix": {}, "applicable": False})
        _acting_user_id, org_id = _require_membership("admin")
        store = get_tenancy_store()
        return json.dumps({
            "status": "success",
            "capabilities": [{"group": g, "key": k, "label": label} for g, k, label in CAPABILITIES],
            "matrix": store.get_role_capabilities(org_id),
        })

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        acting_user_id, org_id = _require_membership("admin")
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        role = str(data.get("role", "") or "")
        capability = str(data.get("capability", "") or "")
        granted = bool(data.get("granted"))

        store = get_tenancy_store()
        actor = store.get_user(acting_user_id)
        try:
            store.set_role_capability(org_id, role, capability, granted,
                                       actor=actor.email if actor else f"user:{acting_user_id}")
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})
        return json.dumps({"status": "success"})


class InviteAcceptHandler:
    """GET /invite/<token> -- serves the accept-invite page (reuses the
    login shell). POST /api/invites/<token>/accept {"password"} -- public,
    no session required: the token itself is the caller's only credential
    (see TenancyStore.accept_invite's docstring), so this must never trust
    anything from the request body except the new password."""

    def GET(self, token):
        web.header('Content-Type', 'text/html; charset=utf-8')
        from channel.web.core.template import render

        store = get_tenancy_store()
        invite = store.get_invite(token)
        if invite is None or invite.expires_at < __import__("time").time():
            return "<h1>This invite link is invalid or has expired.</h1>"
        html = render("invite.html")
        return html.replace("{{INVITE_TOKEN}}", token).replace("{{INVITE_EMAIL}}", invite.email)

    def POST(self, token):
        web.header('Content-Type', 'application/json; charset=utf-8')
        from agent.tenancy.store import InviteExpired
        from channel.web.core.tenancy_session import create_session_token
        from channel.web.core._common import _session_expire_seconds

        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        password = str(data.get("password", "") or "")
        if len(password) < 8:
            return json.dumps({"status": "error", "message": "Password must be at least 8 characters"})

        store = get_tenancy_store()
        try:
            user, membership = store.accept_invite(token, password)
        except InviteExpired as e:
            return json.dumps({"status": "error", "message": str(e)})
        except ValueError as e:
            return json.dumps({"status": "error", "message": str(e)})

        session_token = create_session_token(user.id, membership.org_id, _session_expire_seconds())
        web.setcookie("cow_auth_token", session_token, expires=_session_expire_seconds(),
                       path="/", httponly=True, samesite="Lax")
        return json.dumps({"status": "success"})
