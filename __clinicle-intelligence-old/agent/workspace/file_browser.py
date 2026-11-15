"""Safe file tree/read/write over one Agent's own workspace root, for the
built-in Code Editor (channel/web/api/workspace_files.py). A DIFFERENT,
narrower thing than agent/admin.py's read_core_file/write_core_file (a fixed
allowlist of five persona files, AGENT.md/USER.md/RULE.md/MEMORY.md/
BOOTSTRAP.md) -- this browses and edits arbitrary files under the workspace,
which is exactly why every path here is re-validated against the root on
every call rather than trusted from a prior listing.

Never raises on a bad path -- callers (the API layer) turn ValueError into a
400, same convention as every other workspace API in this codebase.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

MAX_FILE_BYTES = 1024 * 1024  # 1MB, same ceiling as agent/admin.py's core files.

# Hidden from the tree outright -- never worth browsing, and some (`.git`)
# would otherwise dwarf the actual project in entry count.
_IGNORED_NAMES = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".DS_Store",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".swarm",
}


class WorkspacePathError(ValueError):
    """A requested path is outside the workspace root, or otherwise invalid."""


def _safe_path(root: str, relpath: str) -> Path:
    """Resolves ``relpath`` against ``root`` and refuses anything that
    escapes it -- an absolute path, ``..`` traversal, or a symlink pointing
    outside. ``resolve()`` on both sides means an absolute ``relpath`` (which
    pathlib's own ``/`` operator would otherwise let silently replace the
    root entirely) is still caught by the containment check below."""
    root_path = Path(root).resolve()
    candidate = (root_path / (relpath or "")).resolve()
    if candidate != root_path and root_path not in candidate.parents:
        raise WorkspacePathError(f"path escapes workspace root: {relpath!r}")
    return candidate


def _is_probably_binary(sample: bytes) -> bool:
    return b"\x00" in sample


def list_tree(root: str, relpath: str = "") -> List[Dict[str, Any]]:
    """One directory level (not recursive -- a lazy-expand tree, same UX as
    every real code editor's file panel), sorted directories-first then by
    name."""
    target = _safe_path(root, relpath)
    if not target.is_dir():
        raise WorkspacePathError(f"not a directory: {relpath!r}")
    entries = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name in _IGNORED_NAMES or entry.name.startswith("."):
                    continue
                is_dir = entry.is_dir(follow_symlinks=False)
                entries.append({
                    "name": entry.name,
                    "path": f"{relpath.rstrip('/')}/{entry.name}" if relpath else entry.name,
                    "type": "dir" if is_dir else "file",
                    "size": None if is_dir else entry.stat(follow_symlinks=False).st_size,
                })
    except OSError as e:
        raise WorkspacePathError(str(e))
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return entries


def read_file(root: str, relpath: str) -> Dict[str, Any]:
    target = _safe_path(root, relpath)
    if not target.is_file():
        raise WorkspacePathError(f"not a file: {relpath!r}")
    size = target.stat().st_size
    with open(target, "rb") as f:
        sample = f.read(min(size, 8192))
        if _is_probably_binary(sample):
            # Lets the caller offer an inline preview (image/PDF) or a
            # download link for anything else -- channel/web/api/files.py's
            # FileServeHandler (/api/file?path=...) already serves raw
            # bytes by absolute path with its own allowlist check, so
            # there's no new serving surface to build for this.
            return {"content": None, "binary": True, "size": size, "abs_path": str(target)}
        f.seek(0)
        raw = f.read(MAX_FILE_BYTES + 1)
    truncated = len(raw) > MAX_FILE_BYTES
    if truncated:
        raw = raw[:MAX_FILE_BYTES]
    return {
        "content": raw.decode("utf-8", errors="replace"),
        "binary": False,
        "size": size,
        "truncated": truncated,
        # SVG is text (XML), so it never hits the binary branch above, but
        # the caller still wants to offer an image preview for it the same
        # way it does for a binary PNG/JPG.
        "abs_path": str(target),
    }


def write_file(root: str, relpath: str, content: str) -> None:
    target = _safe_path(root, relpath)
    if target.is_dir():
        raise WorkspacePathError(f"cannot write a directory: {relpath!r}")
    raw = (content or "").encode("utf-8")
    if len(raw) > MAX_FILE_BYTES:
        raise WorkspacePathError(f"file too large to save ({len(raw)} bytes, max {MAX_FILE_BYTES})")
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as f:
        f.write(raw)


def delete_file(root: str, relpath: str) -> None:
    """Deletes one file. Never recursive and never touches a directory --
    the Code Editor's delete button is scoped to the single open file, not a
    file-manager's rm -rf; removing a whole directory is not exposed here."""
    target = _safe_path(root, relpath)
    if not target.exists():
        raise WorkspacePathError(f"not found: {relpath!r}")
    if target.is_dir():
        raise WorkspacePathError(f"cannot delete a directory: {relpath!r}")
    target.unlink()
