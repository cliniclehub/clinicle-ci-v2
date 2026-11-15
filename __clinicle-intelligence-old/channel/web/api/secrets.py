"""Secrets Vault + Security & Access endpoints: /api/secrets and friends.

Thin layer over ``agent/security/secrets_vault.py`` -- list secret NAMES
only, store a new one, delete one. A value is never echoed back once
stored; the vault itself never exposes decrypted values outside internal
tool code (see that module's docstring).

Auth gate: admin-role membership when a multi-tenant session exists (the
same ``agent/tenancy/store.py`` RBAC ``channel/web/api/tenancy.py`` already
wires up for the Agents & Org page), else the app-wide ``_require_auth()``
gate every other config-mutating endpoint (``channel/web/api/config.py``)
uses. That fallback is the fork point ``agent/tenancy/store.py``'s
``has_any_user()`` documents: a legacy single-password install with no real
accounts keeps today's single-shared-password behavior untouched, and the
moment real accounts exist, secrets management becomes admin-only.
"""

import json

import web

from agent.security.secrets_vault import delete_secret, list_secret_names, store_secret
from channel.web.core._common import _require_auth, _require_capability
from common.log import logger


def _forbidden(message: str):
    return web.HTTPError(
        "403 Forbidden", {"Content-Type": "application/json; charset=utf-8"},
        json.dumps({"status": "error", "message": message}),
    )


def _require_secrets_admin():
    """Admin gate for secrets management. Returns the tenant id to scope the
    vault to: an org id (int) on a multi-tenant session, or None on a legacy
    single-password install (the vault's own default tenant)."""
    from agent.tenancy.store import get_tenancy_store
    from channel.web.api.tenancy import _current_user_and_org

    user_id, org_id = _current_user_and_org()
    if user_id is None:
        _require_auth()
        return None
    if not get_tenancy_store().has_role(user_id, org_id, "admin"):
        raise _forbidden("admin role required")
    _require_capability("settings.security")
    return org_id


def _actor_label(org_id) -> str:
    """Best-effort human label for the audit trail: the signed-in user's
    email on a multi-tenant session, else "web" for legacy single-password
    installs with no per-user identity to attribute the change to."""
    if org_id is None:
        return "web"
    try:
        from agent.tenancy.store import get_tenancy_store
        from channel.web.api.tenancy import _current_user_and_org

        user_id, _org_id = _current_user_and_org()
        if user_id is not None:
            user = get_tenancy_store().get_user(user_id)
            if user:
                return user.email
    except Exception as e:
        logger.debug(f"[Secrets] actor resolution failed: {e}")
    return "web"


class SecretsHandler:
    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _require_secrets_admin()
        try:
            names = list_secret_names(org_id)
            return json.dumps(
                {"status": "success", "secrets": [{"name": n} for n in names]}, ensure_ascii=False
            )
        except Exception as e:
            logger.error(f"[Secrets] list failed: {e}")
            return json.dumps({"status": "error", "message": "Could not list secrets"})

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _require_secrets_admin()
        try:
            body = json.loads(web.data() or "{}")
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        name = str(body.get("name") or "").strip()
        value = body.get("value")
        if not name:
            return json.dumps({"status": "error", "message": "name is required"})
        if not isinstance(value, str) or not value:
            return json.dumps({"status": "error", "message": "value is required"})
        try:
            store_secret(org_id, name, value, actor=_actor_label(org_id))
        except Exception as e:
            logger.error(f"[Secrets] store failed: {e}")
            return json.dumps({"status": "error", "message": "Could not store secret"})
        # Never echo the value back -- only the name the caller already knows.
        return json.dumps({"status": "success", "name": name}, ensure_ascii=False)


class SecretHandler:
    def DELETE(self, name):
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _require_secrets_admin()
        try:
            deleted = delete_secret(org_id, name, actor=_actor_label(org_id))
        except Exception as e:
            logger.error(f"[Secrets] delete failed: {e}")
            return json.dumps({"status": "error", "message": "Could not delete secret"})
        if not deleted:
            web.ctx.status = "404 Not Found"
            return json.dumps({"status": "error", "message": "Secret not found"})
        return json.dumps({"status": "success"})


class SecuritySessionsHandler:
    """GET /api/security/sessions -- per-member sign-in state for the admin
    Security & Access page. POST .../<user_id>/revoke -- signs that member
    out everywhere.

    There is no server-side session store (``tenancy_session.py``'s tokens
    are stateless HMAC), so this can't list individual devices/IPs the way a
    session table would -- ``last_login_at`` is the closest available signal,
    and revoke works via a per-user cutoff timestamp
    (``TenancyStore.revoke_all_sessions``) rather than deleting one session
    row. Same admin gate and same legacy-install fork as ``MfaCoverageHandler``
    right below: nothing to list or revoke on a single-password install with
    no real accounts."""

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _require_secrets_admin()
        try:
            sessions = []
            if org_id is not None:
                from agent.tenancy.store import get_tenancy_store
                from channel.web.api.tenancy import _current_user_and_org

                store = get_tenancy_store()
                acting_user_id, _ = _current_user_and_org()
                for membership in store.list_memberships_for_org(org_id):
                    user = store.get_user(membership.user_id)
                    if user is None:
                        continue
                    sessions.append({
                        "user_id": user.id, "email": user.email, "role": membership.role,
                        "last_login_at": user.last_login_at,
                        "sessions_revoked_at": user.sessions_revoked_at,
                        "is_self": user.id == acting_user_id,
                    })
            return json.dumps({
                "status": "success", "sessions": sessions, "applicable": org_id is not None,
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[Secrets] sessions list failed: {e}")
            return json.dumps({"status": "error", "message": "Could not load sessions"})


class SecuritySessionRevokeHandler:
    def POST(self, user_id):
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _require_secrets_admin()
        if org_id is None:
            return json.dumps({"status": "error", "message": "Not applicable on this install"})
        try:
            target_user_id = int(user_id)
        except ValueError:
            web.ctx.status = "404 Not Found"
            return json.dumps({"status": "error", "message": "Member not found"})

        from agent.tenancy.store import get_tenancy_store
        store = get_tenancy_store()
        # Scope to this org at the query level -- a membership row must exist
        # here, never trust the user_id in the URL alone (SC-IDOR).
        if store.get_membership(target_user_id, org_id) is None:
            web.ctx.status = "404 Not Found"
            return json.dumps({"status": "error", "message": "Member not found"})
        try:
            store.revoke_all_sessions(target_user_id, actor=_actor_label(org_id))
        except Exception as e:
            logger.error(f"[Secrets] session revoke failed: {e}")
            return json.dumps({"status": "error", "message": "Could not revoke sessions"})
        return json.dumps({"status": "success"})


class MfaCoverageHandler:
    """Org-wide, read-only MFA summary for the admin Security & Access page.

    Distinct from the per-user self-enroll flow on the Agents & Org page
    (``channel/web/api/auth.py``'s enroll/confirm/disable handlers) -- this
    only counts, it never mutates MFA state. Reuses
    ``agent/tenancy/store.py``'s ``list_memberships_for_org`` directly (the
    same store call ``channel/web/api/tenancy.py``'s ``OrgMembersHandler``
    already uses to include ``mfa_enabled`` per member) rather than adding a
    second members-listing endpoint.
    """

    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        org_id = _require_secrets_admin()
        try:
            total = 0
            enabled = 0
            if org_id is not None:
                from agent.tenancy.store import get_tenancy_store

                store = get_tenancy_store()
                for membership in store.list_memberships_for_org(org_id):
                    user = store.get_user(membership.user_id)
                    if user is None:
                        continue
                    total += 1
                    if user.mfa_enabled:
                        enabled += 1
            return json.dumps({
                "status": "success",
                "mfa_coverage": {
                    "total_members": total,
                    "mfa_enabled": enabled,
                    "mfa_disabled": total - enabled,
                    "applicable": org_id is not None,
                },
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[Secrets] MFA coverage failed: {e}")
            return json.dumps({"status": "error", "message": "Could not load MFA coverage"})
