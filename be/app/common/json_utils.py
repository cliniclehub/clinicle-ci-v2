from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID


def json_safe_value(value: Any) -> Any:
    """Recursively convert values for JSON/JSONB column storage."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe_value(item) for item in value]
    if isinstance(value, set):
        return [json_safe_value(item) for item in value]
    return value
