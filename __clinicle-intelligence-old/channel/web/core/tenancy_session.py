"""Session tokens for the multi-tenant auth path.

The legacy console password signs its token with the password itself
(`_verify_auth_token` in `channel/web/core/_common.py`) — there is no single
password to sign with once real per-user accounts exist, so this module keeps
its own persistent secret instead: `~/.cow/session_secret`, generated once,
chmod'd 0600, alongside the existing `~/.cow/mcp_oauth.json` /
`~/.cow/platform.db` convention.

A token is ``<user_id>.<org_id>.<ts_hex>.<sig>``, HMAC-SHA256 signed. Kept
deliberately parallel in shape to the legacy token
(``<ts_hex>.<sig>``) rather than reusing its verifier, since the two paths
sign with different keys and must never be cross-checked against each other.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from pathlib import Path
from typing import Optional, Tuple


def _secret_path() -> Path:
    return Path(os.path.expanduser("~/.cow/session_secret"))


def _session_secret() -> bytes:
    path = _secret_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_bytes()
    secret = os.urandom(32)
    path.write_bytes(secret)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return secret


def create_session_token(user_id: int, org_id: int, expire_seconds: int) -> str:
    ts_hex = format(int(time.time()), "x")
    payload = f"{user_id}.{org_id}.{ts_hex}"
    sig = hmac.new(_session_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _decode_and_verify(token: str, expire_seconds: int) -> Optional[Tuple[int, int, int]]:
    """(user_id, org_id, issued_at) on a valid, unexpired token, else None."""
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 4:
        return None
    user_id_s, org_id_s, ts_hex, sig = parts
    payload = f"{user_id_s}.{org_id_s}.{ts_hex}"
    expected = hmac.new(_session_secret(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        ts = int(ts_hex, 16)
        user_id = int(user_id_s)
        org_id = int(org_id_s)
    except ValueError:
        return None
    if time.time() - ts > expire_seconds:
        return None
    return user_id, org_id, ts


def verify_session_token(token: str, expire_seconds: int) -> Optional[Tuple[int, int]]:
    """Returns (user_id, org_id) on a valid, unexpired token, else None.

    Pure HMAC + expiry check, deliberately DB-free (no TenancyStore lookup)
    so it stays unit-testable in isolation (see ``tests/test_tenancy_session.py``)
    and cheap for internal checks like ``needs_rotation`` that don't need
    revocation. Every request-authorization call site should use
    ``verify_session_token_active`` below instead, not this one directly.
    """
    decoded = _decode_and_verify(token, expire_seconds)
    return (decoded[0], decoded[1]) if decoded else None


def verify_session_token_active(token: str, expire_seconds: int) -> Optional[Tuple[int, int]]:
    """Same as ``verify_session_token``, plus the revocation check every
    real request-authorization path needs: a token issued before the user's
    ``sessions_revoked_at`` cutoff fails here even though it's still
    cryptographically valid and unexpired.

    Since a token carries no session id (see module docstring), "sign out
    everywhere" works via that per-user cutoff timestamp (set by
    ``TenancyStore.revoke_all_sessions``) rather than deleting a row from a
    session table -- any token issued before the cutoff stops verifying, no
    matter how much of its HMAC lifetime remains.
    """
    decoded = _decode_and_verify(token, expire_seconds)
    if decoded is None:
        return None
    user_id, org_id, issued_at = decoded
    from agent.tenancy.store import get_tenancy_store

    user = get_tenancy_store().get_user(user_id)
    if user is None:
        return None
    if user.sessions_revoked_at and issued_at < user.sessions_revoked_at:
        return None
    return user_id, org_id


def needs_rotation(token: str, expire_seconds: int) -> bool:
    """True once a valid token has used up half its lifetime.

    Sliding-window rotation: a session that stays active never hits the hard
    expiry, but a stolen token that goes unused still dies on schedule
    because rotation only happens on a request that already proved
    possession of the current token.
    """
    decoded = _decode_and_verify(token, expire_seconds)
    if decoded is None:
        return False
    _, _, issued_at = decoded
    return (time.time() - issued_at) > (expire_seconds / 2)
