"""Signing in to the console, and the MCP OAuth callback.

The console's own password check plus the redirect target an MCP server
sends the user back to after authorising it.
"""

import hashlib
import hmac
import json
import time

import web

from channel.web.core._common import (
    _check_auth,
    _get_bearer_token,
    _get_query_token,
    _get_web_password,
    _is_password_enabled,
    _session_expire_seconds,
)
from common.log import logger


def _current_user_id():
    """Resolve the acting user from the multi-tenant session token, or None
    (legacy single-password installs have no per-user identity to enroll
    MFA against)."""
    from channel.web.core.tenancy_session import verify_session_token_active

    for token in (web.cookies().get("cow_auth_token", ""), _get_bearer_token(), _get_query_token()):
        if not token:
            continue
        identity = verify_session_token_active(token, _session_expire_seconds())
        if identity is not None:
            return identity[0]
    return None


def _create_auth_token():
    """Create a stateless signed token: ``<timestamp_hex>.<hmac_hex>``."""
    ts = format(int(time.time()), "x")
    sig = hmac.new(
        _get_web_password().encode(),
        ts.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{ts}.{sig}"


class McpOAuthCallbackHandler:
    """OAuth redirect target for MCP servers requiring authorization.

    The browser lands here after the user authorizes a remote MCP server.
    We exchange the authorization code for tokens and bring the server
    online. Unauthenticated by design: the OAuth `state` param is the
    single-use secret that binds this request to a pending authorization.
    """

    def GET(self):
        web.header('Content-Type', 'text/html; charset=utf-8')
        params = web.input(code="", state="", error="", error_description="")

        def _page(title: str, message: str) -> str:
            return (
                "<!doctype html><html><head><meta charset='utf-8'>"
                "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                f"<title>{title}</title></head>"
                "<body style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;"
                "max-width:520px;margin:64px auto;padding:0 20px;text-align:center;color:#1f2328'>"
                f"<h2>{title}</h2><p style='color:#57606a'>{message}</p></body></html>"
            )

        if params.error:
            logger.warning(f"[MCP-OAuth] callback error: {params.error} {params.error_description}")
            return _page("授权失败", f"{params.error}: {params.error_description or ''}")

        if not params.code or not params.state:
            return _page("参数缺失", "回调缺少 code 或 state 参数。")

        try:
            from agent.tools.mcp.mcp_oauth import pop_pending
            from agent.tools.mcp.mcp_client import notify_server_authorized
        except Exception as e:
            logger.warning(f"[MCP-OAuth] callback import failed: {e}")
            return _page("内部错误", "OAuth 模块不可用。")

        handler = pop_pending(params.state)
        if handler is None:
            return _page("会话已过期", "授权请求不存在或已过期，请重新触发授权。")

        try:
            ok = handler.finish_authorization(params.code)
        except Exception as e:
            logger.warning(f"[MCP-OAuth] token exchange crashed: {e}")
            ok = False

        if not ok:
            return _page("授权失败", "换取令牌失败，请重试。")

        notify_server_authorized(handler.server_name)
        logger.info(f"[MCP-OAuth] Server '{handler.server_name}' authorized via web callback")
        return _page(
            "授权成功",
            f"MCP 服务 “{handler.server_name}” 已授权，可以返回聊天继续使用了。",
        )


class AuthCheckHandler:
    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        if not _is_password_enabled():
            return json.dumps({"status": "success", "auth_required": False})
        if _check_auth():
            return json.dumps({"status": "success", "auth_required": True, "authenticated": True})
        return json.dumps({"status": "success", "auth_required": True, "authenticated": False})


class AuthSignupHandler:
    """Create the first (or a new) account.

    Only reachable while multi-tenant auth is active or being bootstrapped —
    the very first signup on an instance with zero users creates org #1 and
    becomes its owner, which is what the plan calls "migration" for a fresh
    instance: there is nothing to migrate yet, so the first real account
    simply *is* the first tenant.
    """

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        email = str(data.get("email", "") or "").strip()
        password = str(data.get("password", "") or "")
        org_name = str(data.get("org_name", "") or "").strip() or f"{email}'s workspace"
        if not email or "@" not in email:
            return json.dumps({"status": "error", "message": "Valid email required"})
        if len(password) < 8:
            return json.dumps({"status": "error", "message": "Password must be at least 8 characters"})

        from agent.tenancy.store import EmailAlreadyRegistered, get_tenancy_store
        store = get_tenancy_store()
        try:
            user = store.create_user(email, password)
        except EmailAlreadyRegistered:
            return json.dumps({"status": "error", "message": "Email already registered"})

        org = store.create_organization(org_name)
        store.add_membership(user.id, org.id, role="owner")

        from channel.web.core.tenancy_session import create_session_token
        token = create_session_token(user.id, org.id, _session_expire_seconds())
        web.setcookie("cow_auth_token", token, expires=_session_expire_seconds(),
                       path="/", httponly=True, samesite="Lax")
        logger.info(f"[WebChannel] New account: user={user.id} org={org.id}")
        return json.dumps({"status": "success", "token": token})


class AuthLoginHandler:
    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})

        from agent.tenancy.store import get_tenancy_store
        store = get_tenancy_store()

        if store.has_any_user():
            from agent.audit import log as audit_log

            email = str(data.get("email", "") or "").strip()
            password = str(data.get("password", "") or "")
            mfa_code = str(data.get("mfa_code", "") or "").strip()
            user = store.get_user_by_email(email) if email else None
            if user is None or not store.verify_password(user, password):
                logger.warning("[WebChannel] Invalid login attempt")
                audit_log.record_event(None, email or "unknown", "user.login_failed",
                                        {"reason": "bad_credentials"})
                return json.dumps({"status": "error", "message": "Wrong email or password"})
            if user.mfa_enabled:
                if not mfa_code:
                    return json.dumps({"status": "error", "message": "MFA code required",
                                        "mfa_required": True})
                if not store.verify_mfa_code(user, mfa_code):
                    audit_log.record_event(None, email, "user.login_failed", {"reason": "bad_mfa_code"})
                    return json.dumps({"status": "error", "message": "Invalid MFA code"})
            memberships = store.list_memberships_for_user(user.id)
            if not memberships:
                # A user with no org at all is an inconsistent state this
                # flow never produces (signup always creates one) — fail
                # closed rather than guess which org to log them into.
                return json.dumps({"status": "error", "message": "No organization for this account"})
            org_id = memberships[0].org_id

            from channel.web.core.tenancy_session import create_session_token
            token = create_session_token(user.id, org_id, _session_expire_seconds())
            web.setcookie("cow_auth_token", token, expires=_session_expire_seconds(),
                           path="/", httponly=True, samesite="Lax")
            store.touch_last_login(user.id)
            audit_log.record_event(str(org_id), email, "user.login", {"user_id": user.id})
            return json.dumps({"status": "success", "token": token})

        # Legacy single-password path: unchanged for any instance that has
        # never had a real account created on it.
        if not _is_password_enabled():
            return json.dumps({"status": "success"})
        password = str(data.get("password", "") or "")
        expected = _get_web_password()
        if not hmac.compare_digest(password, expected):
            logger.warning("[WebChannel] Invalid login attempt")
            return json.dumps({"status": "error", "message": "Wrong password"})
        token = _create_auth_token()
        web.setcookie("cow_auth_token", token, expires=_session_expire_seconds(),
                       path="/", httponly=True, samesite="Lax")
        # Also return the token in the body: the desktop client (file:// origin)
        # can't rely on the cookie and sends it back via an Authorization header.
        return json.dumps({"status": "success", "token": token})


class AuthLogoutHandler:
    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        web.setcookie("cow_auth_token", "", expires=-1, path="/")
        return json.dumps({"status": "success"})


class MfaEnrollHandler:
    """Start TOTP enrollment for the signed-in user. Returns the secret and
    an otpauth:// URI the client renders as a QR code; MFA stays off until
    MfaConfirmHandler proves the user can actually generate a code with it."""

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        user_id = _current_user_id()
        if user_id is None:
            raise web.HTTPError("401 Unauthorized", {"Content-Type": "application/json; charset=utf-8"},
                                 json.dumps({"status": "error", "message": "Unauthorized"}))

        import pyotp

        from agent.tenancy.store import get_tenancy_store
        store = get_tenancy_store()
        user = store.get_user(user_id)
        secret = store.enroll_mfa(user_id, actor=user.email)
        uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Clinicle Intelligence")
        return json.dumps({"status": "success", "secret": secret, "otpauth_uri": uri})


class MfaConfirmHandler:
    """Finish TOTP enrollment: proves the user can generate a valid code
    before MFA actually turns on for their account."""

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        user_id = _current_user_id()
        if user_id is None:
            raise web.HTTPError("401 Unauthorized", {"Content-Type": "application/json; charset=utf-8"},
                                 json.dumps({"status": "error", "message": "Unauthorized"}))
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        code = str(data.get("code", "") or "").strip()

        from agent.tenancy.store import get_tenancy_store
        store = get_tenancy_store()
        user = store.get_user(user_id)
        if not store.confirm_mfa(user_id, code, actor=user.email):
            return json.dumps({"status": "error", "message": "Invalid code"})
        return json.dumps({"status": "success"})


class MfaDisableHandler:
    """Turn MFA off. Requires the current password, not just a live session —
    disabling a second factor is exactly the kind of action a hijacked but
    not-yet-fully-compromised session shouldn't be able to do silently."""

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        user_id = _current_user_id()
        if user_id is None:
            raise web.HTTPError("401 Unauthorized", {"Content-Type": "application/json; charset=utf-8"},
                                 json.dumps({"status": "error", "message": "Unauthorized"}))
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        password = str(data.get("password", "") or "")

        from agent.tenancy.store import get_tenancy_store
        store = get_tenancy_store()
        user = store.get_user(user_id)
        if user is None or not store.verify_password(user, password):
            return json.dumps({"status": "error", "message": "Wrong password"})
        store.disable_mfa(user_id, actor=user.email)
        return json.dumps({"status": "success"})


class ChangePasswordHandler:
    """POST /auth/change-password {"old_password","new_password"} -- the
    signed-in user's own account only, never a target id in the body (same
    reason MfaDisableHandler requires the current password: no way for a
    hijacked-but-not-fully-compromised session to silently take this over
    the way it could if it only needed the live session cookie)."""

    def POST(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        user_id = _current_user_id()
        if user_id is None:
            raise web.HTTPError("401 Unauthorized", {"Content-Type": "application/json; charset=utf-8"},
                                 json.dumps({"status": "error", "message": "Unauthorized"}))
        try:
            data = json.loads(web.data())
        except Exception:
            return json.dumps({"status": "error", "message": "Invalid request"})
        old_password = str(data.get("old_password", "") or "")
        new_password = str(data.get("new_password", "") or "")
        if len(new_password) < 8:
            return json.dumps({"status": "error", "message": "New password must be at least 8 characters"})

        from agent.tenancy.store import get_tenancy_store
        store = get_tenancy_store()
        user = store.get_user(user_id)
        actor = user.email if user else f"user:{user_id}"
        if not store.change_password(user_id, old_password, new_password, actor=actor):
            return json.dumps({"status": "error", "message": "Current password is incorrect"})
        return json.dumps({"status": "success"})
