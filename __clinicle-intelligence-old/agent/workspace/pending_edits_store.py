"""Pending Edits store: file changes staged by the approval gate
(``agent/permission/execution_gate.py``) awaiting a human's Accept/Reject.

A DIFFERENT domain from the Review Queue (``review_queue_store.py``): that
table holds business-rule flags (category/severity/evidence_ref) four
compliance agents raise for a human to action -- this one holds a raw diff
payload plus the original tool-call arguments needed to actually apply the
change on Accept. Wrong shape either direction; kept separate on purpose.
Same SQLite-over-shared_root() skeleton as that file (migrate/connect/WAL),
copied deliberately rather than shared, since the two stores' schemas will
keep diverging.

Nothing here executes a tool. Staging writes a row; accepting
(``channel/web/api/pending_edits.py``) is what actually calls
``tool.execute_tool(arguments)``.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from common.log import logger

_LOCK = threading.Lock()

STATUSES = ("pending", "approved", "rejected")


def _default_org_id() -> Optional[str]:
    """Same single-org convenience default as review_queue_store.py -- see
    its docstring for why an ambiguous multi-org install gets None instead."""
    try:
        from agent.tenancy.store import get_tenancy_store

        store = get_tenancy_store()
        conn = store._connect()
        try:
            rows = conn.execute("SELECT id FROM organizations LIMIT 2").fetchall()
        finally:
            conn.close()
    except Exception:
        return None
    return str(rows[0][0]) if len(rows) == 1 else None


def _db_path(org_id: Optional[str]) -> Path:
    from common.runtime_identity import RuntimeIdentity
    from common.state_dir import shared_root
    # Defensive: RuntimeIdentity.org_id is typed Optional[str], but a real web
    # session's org_id actually decodes as an int (see
    # channel/web/core/tenancy_session.py's _decode_and_verify, which does
    # `org_id = int(org_id_s)`) -- shared_root()'s own path-join then raises
    # TypeError on that int. review_queue_store.py has this exact same latent
    # bug from the same pattern; not fixed there as part of this feature, but
    # guarded here so this store works regardless of what a caller passes.
    org_id = str(org_id) if org_id is not None else None
    return shared_root(RuntimeIdentity(org_id=org_id)) / "pending_edits.db"


def _connect(org_id: Optional[str] = None) -> sqlite3.Connection:
    if org_id is not None:
        org_id = str(org_id)
    if org_id is None:
        org_id = _default_org_id()
    path = _db_path(org_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    is_new = not path.exists()
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    _migrate(conn)
    if is_new:
        try:
            os.chmod(path, 0o600)
        except OSError as e:
            logger.debug(f"[PendingEditsStore] chmod 0600 skipped: {e}")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_edits (
            id TEXT PRIMARY KEY,
            org_id TEXT,
            agent_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            run_id TEXT,
            tool_call_id TEXT,
            tool_name TEXT NOT NULL,
            path TEXT,
            cwd TEXT,
            arguments TEXT NOT NULL,
            diff TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at REAL NOT NULL,
            resolved_at REAL,
            resolved_by_user_id INTEGER,
            resolution_note TEXT,
            result TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pending_edits_org_status "
        "ON pending_edits(org_id, status, created_at)"
    )
    conn.commit()


def _new_id() -> str:
    return f"pend_{uuid.uuid4().hex[:12]}"


def _row(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    if data.get("arguments"):
        try:
            data["arguments"] = json.loads(data["arguments"])
        except (TypeError, ValueError):
            pass
    if data.get("result"):
        try:
            data["result"] = json.loads(data["result"])
        except (TypeError, ValueError):
            pass
    return data


def _normalize_org_id(org_id) -> Optional[str]:
    """Callers (notably a real web session's ``current_identity().org_id``,
    which decodes as an int -- see ``_db_path``'s docstring) may pass an int.
    Every column here is TEXT and every path-join needs a string, so this is
    the one place that decision is made, consistently, for both."""
    return str(org_id) if org_id is not None else None


def create_pending_edit(
    *, org_id: Optional[str], agent_id: str, session_id: str, tool_name: str,
    arguments: Dict[str, Any], diff: str = "", path: str = "", cwd: str = "",
    run_id: Optional[str] = None, tool_call_id: Optional[str] = None,
) -> Dict[str, Any]:
    if tool_name not in ("edit", "write"):
        raise ValueError(f"pending edits only support edit/write, got {tool_name!r}")
    org_id = _normalize_org_id(org_id)
    if org_id is None:
        org_id = _default_org_id()
    now = time.time()
    row = {
        "id": _new_id(), "org_id": org_id, "agent_id": agent_id, "session_id": session_id,
        "run_id": run_id, "tool_call_id": tool_call_id, "tool_name": tool_name,
        "path": path, "cwd": cwd, "arguments": json.dumps(arguments, ensure_ascii=False),
        "diff": diff, "status": "pending", "created_at": now,
    }
    with _LOCK:
        conn = _connect(org_id)
        try:
            conn.execute(
                """INSERT INTO pending_edits
                   (id, org_id, agent_id, session_id, run_id, tool_call_id, tool_name,
                    path, cwd, arguments, diff, status, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (row["id"], row["org_id"], row["agent_id"], row["session_id"], row["run_id"],
                 row["tool_call_id"], row["tool_name"], row["path"], row["cwd"], row["arguments"],
                 row["diff"], row["status"], row["created_at"]),
            )
            conn.commit()
        finally:
            conn.close()
    return get_pending_edit(row["id"], org_id=org_id)


def get_pending_edit(pending_id: str, *, org_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    conn = _connect(org_id)
    try:
        row = conn.execute("SELECT * FROM pending_edits WHERE id = ?", (pending_id,)).fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


def list_pending_edits(
    org_id: Optional[str], *, status: Optional[str] = None, agent_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    org_id = _normalize_org_id(org_id)
    conn = _connect(org_id)
    try:
        query = "SELECT * FROM pending_edits WHERE (org_id = ? OR (? IS NULL AND org_id IS NULL))"
        params: List[Any] = [org_id, org_id]
        if status:
            query += " AND status = ?"
            params.append(status)
        if agent_id:
            query += " AND agent_id = ?"
            params.append(agent_id)
        query += " ORDER BY (status = 'pending') DESC, created_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def resolve_pending_edit(
    pending_id: str, status: str, *, resolved_by_user_id: Optional[int],
    result: Optional[Dict[str, Any]] = None, note: Optional[str] = None,
    org_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Marks a pending edit approved/rejected. Does NOT execute the tool --
    the caller (channel/web/api/pending_edits.py's approve handler) runs
    ``tool.execute_tool(arguments)`` itself and passes the outcome in via
    ``result`` so the record shows what actually happened, not just the
    intent to run it.

    ``org_id``: each org's pending edits live in a separate per-org SQLite
    file (see ``_db_path``), so without it this falls back to
    ``_default_org_id()`` -- correct for a single-org install, but on a real
    multi-org one it can silently connect to the WRONG org's file and find
    nothing to resolve. A caller that already knows the org (every real
    caller does -- the API handler has it from the request) should always
    pass it explicitly."""
    if status not in ("approved", "rejected"):
        raise ValueError(f"invalid resolution status: {status!r}")
    org_id = _normalize_org_id(org_id)
    existing = get_pending_edit(pending_id, org_id=org_id)
    if existing is None:
        return None
    now = time.time()
    with _LOCK:
        conn = _connect(org_id)
        try:
            conn.execute(
                """UPDATE pending_edits SET status = ?, resolved_by_user_id = ?,
                   resolution_note = ?, resolved_at = ?, result = ?
                   WHERE id = ? AND status = 'pending'""",
                (status, resolved_by_user_id, note, now,
                 json.dumps(result, ensure_ascii=False) if result is not None else None,
                 pending_id),
            )
            conn.commit()
        finally:
            conn.close()
    return get_pending_edit(pending_id, org_id=org_id)
