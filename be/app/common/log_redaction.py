"""Redact sensitive values before logging request/response payloads."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_SENSITIVE_KEY_PATTERN = re.compile(
    r"(password|passwd|secret|token|authorization|auth|cookie|api[_-]?key|"
    r"access[_-]?key|refresh[_-]?token|session|credit|card|cvv|cvc|ssn|"
    r"payment[_-]?method|client[_-]?secret|private[_-]?key|"
    r"presigned|playback|signed[_-]?url|media[_-]?token|"
    r"(^|_)(otp|code)$|(email)?verification[_-]?code)",
    re.IGNORECASE,
)

_SENSITIVE_QUERY_KEYS = {
    "token",
    "mediatoken",
    "media_token",
    "access_token",
    "refresh_token",
    "authorization",
    "invitationtoken",
    "invitation_token",
    "code",
    "otp",
    "expires",
    "signature",
    "x-amz-signature",
    "x-amz-credential",
    "x-amz-security-token",
}

_REDACTED = "[REDACTED]"


def _is_sensitive_key(key: str) -> bool:
    return bool(_SENSITIVE_KEY_PATTERN.search(str(key)))


def redact_for_log(value: Any, *, max_depth: int = 8) -> Any:
    """Return a copy of value with sensitive keys/headers/URL secrets redacted."""
    return _redact_value(value, depth=0, max_depth=max_depth)


def redact_url_for_log(url: str) -> str:
    """Strip sensitive query params from a URL string for safe logging."""
    if not url or not isinstance(url, str):
        return url
    try:
        parts = urlsplit(url)
        if not parts.query:
            return url
        redacted_query = []
        for key, value in parse_qsl(parts.query, keep_blank_values=True):
            if key.lower() in _SENSITIVE_QUERY_KEYS or _is_sensitive_key(key):
                redacted_query.append((key, _REDACTED))
            else:
                redacted_query.append((key, value))
        return urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                parts.path,
                urlencode(redacted_query),
                parts.fragment,
            )
        )
    except Exception:
        return _REDACTED


def _looks_like_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("http://") or lowered.startswith("https://") or "://" in lowered[:16]


def _redact_value(value: Any, *, depth: int, max_depth: int) -> Any:
    if depth >= max_depth:
        return _REDACTED

    if isinstance(value, dict):
        redacted: dict[Any, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            if _is_sensitive_key(key_str):
                redacted[key] = _REDACTED
            else:
                redacted[key] = _redact_value(item, depth=depth + 1, max_depth=max_depth)
        return redacted

    if isinstance(value, list):
        return [_redact_value(item, depth=depth + 1, max_depth=max_depth) for item in value]

    if isinstance(value, tuple):
        return tuple(_redact_value(item, depth=depth + 1, max_depth=max_depth) for item in value)

    if isinstance(value, str) and _looks_like_url(value):
        return redact_url_for_log(value)

    return value


def redact_header_value(header_name: str, header_value: str) -> str:
    if not header_value:
        return "empty"
    name = header_name.lower()
    if name in {"authorization", "cookie", "set-cookie", "session-token"}:
        return _REDACTED
    if _is_sensitive_key(header_name):
        return _REDACTED
    return header_value
