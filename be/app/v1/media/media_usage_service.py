"""Media usage lookup extension points for product-specific references."""

from __future__ import annotations

from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session


def find_media_file_usages(
    db: Session,
    *,
    organization_id: UUID,
    object_key: str,
    media_url: Optional[str] = None,
) -> List:
    del db, organization_id, object_key, media_url
    return []


def count_object_key_usages(
    db: Session,
    *,
    organization_id: UUID,
    object_keys: List[str],
) -> Dict[str, int]:
    del db, organization_id
    return {key: 0 for key in object_keys if isinstance(key, str) and key.strip()}
