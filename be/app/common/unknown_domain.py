"""Detect expected unknown-tenant domain lookups (crawler / wrong-host noise)."""

from __future__ import annotations

from app.common.business_exceptions import AppError, NotFoundError, ResourceNotFoundError


def is_unknown_domain_not_found_message(message: str | None) -> bool:
    msg = (message or "").strip().lower()
    if "not found" not in msg:
        return False
    return "domain '" in msg or 'domain "' in msg or "for domain" in msg


def is_unknown_domain_not_found(exc: AppError) -> bool:
    if not isinstance(exc, (NotFoundError, ResourceNotFoundError)):
        return False
    return is_unknown_domain_not_found_message(getattr(exc, "message", None))
