"""
Shared path-safety helper for services that resolve a user-supplied relative
path against a fixed root directory (knowledge base, memory files, ...).

Extracted from agent/knowledge/service.py's KnowledgeService._resolve_path,
which was more robust than the equivalent agent/memory/service.py
implementation: it rejects empty/`.`/`..` segments and invalid filename
characters up front, and validates against the nearest *existing* ancestor
so a symlink escape is caught even when the final path doesn't exist yet.
"""

import re
from pathlib import Path

_INVALID_NAME_RE = re.compile(r'[<>:"|?*\x00-\x1f]')


def resolve_safe_path(root, rel_path: str, *, allow_missing: bool = True) -> tuple:
    """
    Safely resolve ``rel_path`` under ``root``, rejecting ``..``/absolute
    segments, invalid filename characters, and symlink escapes.

    :param root: Directory the resolved path must stay under.
    :param rel_path: User-supplied path, relative to ``root``.
    :param allow_missing: When False, raise if the resolved path doesn't exist.
    :return: ``(normalized_rel_path, candidate_path)`` — ``candidate_path`` is
        the literal (unresolved) path under ``root``, safe for I/O.
    :raises ValueError: rel_path is empty, invalid, or escapes ``root``.
    :raises FileNotFoundError: ``allow_missing`` is False and the path is missing.
    """
    if not isinstance(rel_path, str) or not rel_path.strip():
        raise ValueError("path is required")
    rel_path = rel_path.replace("\\", "/").strip("/")
    parts = rel_path.split("/")
    if any(not p or p in (".", "..") or _INVALID_NAME_RE.search(p) for p in parts):
        raise ValueError("invalid path")

    root = Path(root).resolve()
    candidate = root.joinpath(*parts)
    # Resolve the nearest existing ancestor so a symlink cannot be used to
    # escape when the final destination does not exist yet.
    ancestor = candidate
    while not ancestor.exists() and ancestor != root:
        ancestor = ancestor.parent
    try:
        ancestor.resolve().relative_to(root)
    except ValueError:
        raise ValueError("path outside root dir")
    if candidate.exists():
        try:
            candidate.resolve().relative_to(root)
        except ValueError:
            raise ValueError("path outside root dir")
    elif not allow_missing:
        raise FileNotFoundError(f"path not found: {rel_path}")
    return rel_path, candidate
