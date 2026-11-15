"""Person-name normalization and validation for consistent storage."""

from __future__ import annotations

import unicodedata
from typing import Optional

PERSON_NAME_TOO_SHORT_MESSAGE = (
    "Name must contain at least two letters (single initials are not allowed)"
)


def normalize_person_name(value: Optional[str]) -> str:
    """Trim and title-case a person name for storage.

    Handles spaces, hyphens, and apostrophes (e.g. ``mary-jane o'brien`` →
    ``Mary-Jane O'Brien``). Empty / whitespace-only input becomes ``""``.
    """
    if value is None:
        return ""
    text = " ".join(str(value).split())
    if not text:
        return ""
    return " ".join(_normalize_name_word(word) for word in text.split(" "))


def count_person_name_letters(value: Optional[str]) -> int:
    """Count Unicode letter characters in a name (ignores spaces/punctuation)."""
    if value is None:
        return 0
    return sum(1 for ch in str(value) if unicodedata.category(ch).startswith("L"))


def normalize_required_person_name(value: Optional[str]) -> str:
    """Normalize a required person name and reject single-letter / non-letter values."""
    text = normalize_person_name(value)
    if not text:
        raise ValueError("Name is required")
    if count_person_name_letters(text) < 2:
        raise ValueError(PERSON_NAME_TOO_SHORT_MESSAGE)
    return text


def normalize_optional_person_name(value: Optional[str]) -> Optional[str]:
    """Normalize an optional person name; ``None`` stays ``None``."""
    if value is None:
        return None
    return normalize_required_person_name(value)


def _normalize_name_word(word: str) -> str:
    if not word:
        return word
    return "-".join(_normalize_name_particle(part) for part in word.split("-"))


def _normalize_name_particle(part: str) -> str:
    if not part:
        return part
    if "'" in part:
        return "'".join(
            (bit[:1].upper() + bit[1:].lower()) if bit else bit
            for bit in part.split("'")
        )
    return part[:1].upper() + part[1:].lower()
