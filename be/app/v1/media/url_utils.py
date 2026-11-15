"""Helpers for org-hosted R2 / worker media URLs."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

_WORKER_AUTH_QUERY_PARAMS = frozenset(
    {"token", "expires", "local", "mediatoken", "media_token"}
)

_ORG_MEDIA_PATH_PREFIX = "/orgs/"

_MEDIA_URL_FIELD_KEYS = frozenset(
    {
        "mediaUrl",
        "thumbnailUrl",
        "assignmentContentURL",
        "imageUrl",
        "image_url",
        "thumbnail_url",
        "fileUrl",
        "attachmentUrl",
        "url",
    }
)

_RICH_TEXT_FIELD_KEYS = frozenset({"richTextContent", "html", "body"})

_URL_IN_TEXT_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)


def _parse_worker_hostname(raw: str | None) -> str | None:
    trimmed = (raw or "").strip()
    if not trimmed:
        return None
    try:
        normalized = trimmed if "://" in trimmed else f"https://{trimmed}"
        return (urlparse(normalized).hostname or "").lower() or None
    except Exception:
        return None


def configured_media_worker_hostnames() -> frozenset[str]:
    from app.common.config import (
        R2_MEDIA_SERVER_WORKER_URL,
        R2_PUBLIC_MEDIA_SERVER_WORKER_URL,
    )

    hosts: set[str] = set()
    for env_value in (R2_MEDIA_SERVER_WORKER_URL, R2_PUBLIC_MEDIA_SERVER_WORKER_URL):
        hostname = _parse_worker_hostname(env_value)
        if hostname:
            hosts.add(hostname)
    return frozenset(hosts)


def _has_org_media_path(path: str) -> bool:
    return _ORG_MEDIA_PATH_PREFIX in (path or "")


def is_hosted_org_media_url(url: str) -> bool:
    trimmed = (url or "").strip()
    if not trimmed:
        return False

    allowed_hosts = configured_media_worker_hostnames()

    if trimmed.startswith("/"):
        return _has_org_media_path(trimmed)

    try:
        normalized = trimmed if "://" in trimmed else f"https://{trimmed}"
        parsed = urlparse(normalized)
        if not _has_org_media_path(parsed.path or ""):
            return False
        if not allowed_hosts:
            return False
        return (parsed.hostname or "").lower() in allowed_hosts
    except Exception:
        return False


def strip_worker_auth_params_from_url(url: str) -> str:
    """Remove short-lived auth query params from configured hosted worker URLs."""
    trimmed = (url or "").strip()
    if not trimmed or not is_hosted_org_media_url(trimmed):
        return trimmed
    return _strip_auth_query_params(trimmed)


def strip_org_scoped_media_auth_params(url: str) -> str:
    """Remove worker auth params from org-scoped media URLs (import/remap paths)."""
    trimmed = (url or "").strip()
    if not trimmed or not _has_org_media_path(trimmed):
        return trimmed
    return _strip_auth_query_params(trimmed)


def _strip_auth_query_params(url: str) -> str:
    try:
        normalized = url if "://" in url else f"https://{url}"
        parsed = urlparse(normalized)
        filtered = [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in _WORKER_AUTH_QUERY_PARAMS
        ]
        rebuilt = urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                urlencode(filtered),
                parsed.fragment,
            )
        )
        return rebuilt.rstrip("?")
    except Exception:
        return url


def sanitize_urls_in_text(text: str) -> str:
    """Strip worker auth params from embedded absolute URLs in HTML or rich text."""

    def _replace(match: re.Match[str]) -> str:
        return strip_worker_auth_params_from_url(match.group(0))

    return _URL_IN_TEXT_RE.sub(_replace, text)


def sanitize_media_urls_in_value(value: Any) -> Any:
    """Deep-walk JSON-like values and strip worker auth params from known media URL fields."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        sanitized: dict[Any, Any] = {}
        for key, item in value.items():
            if isinstance(item, str):
                if key in _MEDIA_URL_FIELD_KEYS:
                    sanitized[key] = strip_worker_auth_params_from_url(item)
                elif key in _RICH_TEXT_FIELD_KEYS:
                    sanitized[key] = sanitize_urls_in_text(item)
                else:
                    sanitized[key] = item
            else:
                sanitized[key] = sanitize_media_urls_in_value(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_media_urls_in_value(item) for item in value]
    return value


def sanitize_media_content_payload(content: object) -> object:
    """Strip auth parameters from media URLs in stored content JSON."""
    if not isinstance(content, dict):
        return content
    return sanitize_media_urls_in_value(content)
