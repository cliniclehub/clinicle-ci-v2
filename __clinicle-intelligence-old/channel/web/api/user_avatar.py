"""Per-user profile picture: GET /api/users/<id>/avatar serves it to any
signed-in user (same as agent avatars); POST /api/users/me/avatar replaces
the caller's own.

Same storage convention as agents.py's AgentAvatarHandler: file existence on
disk is the source of truth (no DB field needed), atomic write, an
mtime-derived cache-busting revision. The directory is the global root, not
org-scoped -- a user's picture is a fact about that user
(agent/tenancy/store.py's users table is a single global table), not about
any one org they belong to, mirroring _avatar_path()'s own reasoning for
agent avatars.
"""

import json
import os

import web

from channel.web.api.agents import AVATAR_TYPES, MAX_AVATAR_BYTES
from channel.web.core._common import (
    _get_bearer_token, _get_query_token, _raw_web_input, _read_uploaded_file_bytes,
    _require_auth, _session_expire_seconds,
)


def _current_user_id():
    from channel.web.core.tenancy_session import verify_session_token_active

    for token in (web.cookies().get("cow_auth_token", ""), _get_bearer_token(), _get_query_token()):
        if not token:
            continue
        user_id, _org_id = verify_session_token_active(token, _session_expire_seconds())
        if user_id is not None:
            return user_id
    return None


def _user_avatar_dir():
    from common.runtime_identity import RuntimeIdentity
    from common.state_dir import shared_root

    return shared_root(RuntimeIdentity()) / "user_avatars"


def user_avatar_path(user_id) -> str:
    base = _user_avatar_dir()
    for suffix in AVATAR_TYPES:
        candidate = base / f"{user_id}{suffix}"
        if candidate.is_file():
            return str(candidate)
    return None


def user_avatar_rev(user_id) -> str:
    """A cache-busting token derived from the avatar file's mtime -- same
    reasoning as agents.py's _avatar_rev: replacing the file doesn't touch
    any DB row, so a token keyed on the file itself is what makes the
    browser refetch after an upload even past a hard reload."""
    path = user_avatar_path(user_id)
    if not path:
        return None
    try:
        return str(int(os.path.getmtime(path)))
    except OSError:
        return None


class UserAvatarHandler:
    def GET(self, user_id):
        _require_auth()
        path = user_avatar_path(user_id)
        if not path:
            web.ctx.status = "404 Not Found"
            web.header('Content-Type', 'application/json; charset=utf-8')
            return json.dumps({"status": "error", "message": "no avatar"})
        with open(path, "rb") as handle:
            data = handle.read()
        web.header('Content-Type', AVATAR_TYPES[os.path.splitext(path)[1].lower()])
        web.header('Cache-Control', 'private, max-age=86400')
        return data

    def POST(self, user_id):
        """user_id in the URL is always "me" today (the only self-service
        entry point this app has) -- kept as a path segment, not hardcoded,
        so an admin-edits-another-member's-picture feature could reuse this
        handler later without a route change."""
        web.header('Content-Type', 'application/json; charset=utf-8')
        current = _current_user_id()
        if current is None:
            web.ctx.status = "401 Unauthorized"
            return json.dumps({"status": "error", "message": "Unauthorized"})
        if user_id != "me" and str(user_id) != str(current):
            web.ctx.status = "403 Forbidden"
            return json.dumps({"status": "error", "message": "can only change your own picture"})
        try:
            # Raw multipart body, not web.input(): that decodes as UTF-8 and
            # dies on an image's first non-text byte -- same as the agent
            # avatar and knowledge upload handlers.
            params = _raw_web_input()
            upload = params.get("avatar")
            if upload is None:
                return json.dumps({"status": "error", "message": "avatar file required"})
            filename = getattr(upload, "filename", "") or ""
            raw = _read_uploaded_file_bytes(upload)
            if not raw:
                return json.dumps({"status": "error", "message": "avatar file required"})
            if len(raw) > MAX_AVATAR_BYTES:
                return json.dumps({"status": "error", "message": "avatar exceeds 2 MiB"})
            suffix = os.path.splitext(filename)[1].lower()
            if suffix not in AVATAR_TYPES:
                return json.dumps({
                    "status": "error",
                    "message": f"unsupported image type: {suffix or 'unknown'}",
                })

            base = _user_avatar_dir()
            base.mkdir(parents=True, exist_ok=True)
            # Drop any other extension first, so one user never ends up with
            # two avatar files and a resolution order deciding which wins.
            for other in AVATAR_TYPES:
                stale = base / f"{current}{other}"
                if other != suffix and stale.is_file():
                    try:
                        stale.unlink()
                    except OSError:
                        pass
            target = base / f"{current}{suffix}"
            tmp = base / f".{current}{suffix}.tmp"
            with open(tmp, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, target)
            return json.dumps({"status": "success", "avatar_rev": user_avatar_rev(current)})
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})
