"""Shared email address validation and normalization."""

import re
from typing import List, Optional, Tuple

from email_validator import EmailNotValidError, validate_email

# Comma, semicolon, or any whitespace (spaces, tabs, newlines).
_MULTI_EMAIL_SPLIT = re.compile(r"[,;\s]+")


def parse_multi_email_search(search: Optional[str]) -> Optional[List[str]]:
    """
    If ``search`` looks like a paste of 2+ emails (comma/space/semicolon separated),
    return lowercased email tokens. Otherwise return None so callers keep normal search.
    """
    if not search or not str(search).strip():
        return None
    raw = str(search).strip()
    if "@" not in raw:
        return None
    parts = [p.strip().lower() for p in _MULTI_EMAIL_SPLIT.split(raw) if p.strip()]
    emails = [p for p in parts if "@" in p]
    if len(emails) < 2:
        return None
    # Preserve order, drop duplicates
    seen = set()
    unique: List[str] = []
    for email in emails:
        if email not in seen:
            seen.add(email)
            unique.append(email)
    return unique


def normalize_email_address(email: str) -> str:
    """
    Normalize and validate an email address.

    Raises ValueError with a user-friendly message when invalid.
    """
    if not email or not str(email).strip():
        raise ValueError("Email is required")

    cleaned = str(email).strip().lower()
    try:
        validated = validate_email(cleaned, check_deliverability=False)
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc

    return validated.normalized


def validate_email_address(email: str) -> Tuple[bool, Optional[str]]:
    """
    Validate email format.

    Returns (True, normalized_email) or (False, error_message).
    """
    try:
        return True, normalize_email_address(email)
    except ValueError as exc:
        return False, str(exc)
