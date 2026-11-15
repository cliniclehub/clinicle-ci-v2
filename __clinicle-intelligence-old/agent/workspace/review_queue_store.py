"""Review Queue store: AI-raised flags a human reviews and actions.

Four agents (Quality Supervisor, Revenue Optimizer, VAT Compliance, Financial
Controller) all need the same shape of feature -- "here's something I found,
a human decides what to do about it" -- so this is one shared store/page
instead of four one-off ones. Same SQLite-over-shared_root() convention as
meeting_store.py/patient work this session.

A flag is never auto-actioned by anything in this codebase -- action_status
only ever changes via a human clicking Approve/Dismiss in the UI (or calling
the API directly), matching the hard "flag and report, never auto-act"
boundary written into VAT Compliance and Financial Controller's own personas.
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

CATEGORIES = ("quality", "revenue", "vat_compliance", "financial", "inventory", "other")
SEVERITIES = ("low", "medium", "high", "critical")
STATUSES = ("open", "approved", "dismissed")


def _default_org_id() -> Optional[str]:
    """Resolve the org a caller didn't specify.

    Every public function here takes an explicit ``org_id`` -- the caller's
    job, not ambient identity's. But an unset org_id used to fall through to
    ``shared_root()``'s own ambient-identity lookup, which is a *different*
    resolution than the one this module's callers actually did (or didn't)
    bind, so a flag raised with org_id=None could land in a workspace no
    query for any real org_id would ever read from. On an install with
    exactly one organization -- true today -- that org is the only sane
    default; ambiguous multi-org installs get None, same as before.
    """
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
    return shared_root(RuntimeIdentity(org_id=org_id)) / "review_queue.db"


def _connect(org_id: Optional[str] = None) -> sqlite3.Connection:
    if org_id is None:
        org_id = _default_org_id()
    path = _db_path(org_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    is_new = not path.exists()
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL: a write (raising/actioning a flag) otherwise takes an exclusive
    # lock that blocks every concurrent read (the Review Queue page listing
    # flags) until it commits and fsyncs. Same fix already applied to
    # conversation_store.py/memory/storage.py.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    _migrate(conn)
    if is_new:
        try:
            os.chmod(path, 0o600)
        except OSError as e:
            logger.debug(f"[ReviewQueueStore] chmod 0600 skipped: {e}")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS flags (
            id TEXT PRIMARY KEY,
            org_id TEXT,
            source_agent_id TEXT NOT NULL,
            category TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'medium',
            title TEXT NOT NULL,
            detail TEXT,
            evidence_ref TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            actioned_by_user_id INTEGER,
            actioned_note TEXT,
            created_at REAL NOT NULL,
            actioned_at REAL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_flags_org_status ON flags(org_id, status, created_at)")
    conn.commit()


def _new_id() -> str:
    return f"flag_{uuid.uuid4().hex[:12]}"


def _row(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


def raise_flag(*, org_id: Optional[str], source_agent_id: str, category: str, title: str,
               detail: Optional[str] = None, evidence_ref: Optional[str] = None,
               severity: str = "medium") -> Dict[str, Any]:
    if category not in CATEGORIES:
        raise ValueError(f"unknown category: {category!r}")
    if severity not in SEVERITIES:
        raise ValueError(f"unknown severity: {severity!r}")
    if not title or not title.strip():
        raise ValueError("title is required")
    if org_id is None:
        org_id = _default_org_id()
    now = time.time()
    flag = {
        "id": _new_id(), "org_id": org_id, "source_agent_id": source_agent_id,
        "category": category, "severity": severity, "title": title.strip(),
        "detail": detail, "evidence_ref": evidence_ref, "status": "open",
        "actioned_by_user_id": None, "actioned_note": None,
        "created_at": now, "actioned_at": None,
    }
    with _LOCK:
        conn = _connect(org_id)
        try:
            conn.execute(
                """INSERT INTO flags
                   (id, org_id, source_agent_id, category, severity, title, detail,
                    evidence_ref, status, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (flag["id"], flag["org_id"], flag["source_agent_id"], flag["category"],
                 flag["severity"], flag["title"], flag["detail"], flag["evidence_ref"],
                 flag["status"], flag["created_at"]),
            )
            conn.commit()
        finally:
            conn.close()
    # Alerts (channel/web/api/alerts.py) reads agent.audit.log, not this
    # table -- without this, a raised flag is invisible to the one place an
    # operator actually watches for something needing attention.
    from agent.audit import log as audit_log
    audit_log.record_event(org_id, source_agent_id, "review_queue.flag_raised",
                            {"flag_id": flag["id"], "category": category, "title": flag["title"]})
    return flag


def get_flag(flag_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM flags WHERE id = ?", (flag_id,)).fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


def list_flags(org_id: Optional[str], *, status: Optional[str] = None,
               category: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = _connect(org_id)
    try:
        query = "SELECT * FROM flags WHERE (org_id = ? OR (? IS NULL AND org_id IS NULL))"
        params: List[Any] = [org_id, org_id]
        if status:
            query += " AND status = ?"
            params.append(status)
        if category:
            query += " AND category = ?"
            params.append(category)
        query += " ORDER BY (status = 'open') DESC, severity DESC, created_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def action_flag(flag_id: str, status: str, *, actioned_by_user_id: Optional[int],
                 note: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if status not in ("approved", "dismissed"):
        raise ValueError(f"invalid action status: {status!r}")
    if get_flag(flag_id) is None:
        return None
    now = time.time()
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                """UPDATE flags SET status = ?, actioned_by_user_id = ?, actioned_note = ?,
                   actioned_at = ? WHERE id = ?""",
                (status, actioned_by_user_id, note, now, flag_id),
            )
            conn.commit()
        finally:
            conn.close()
    return get_flag(flag_id)
