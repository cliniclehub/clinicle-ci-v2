"""Meeting Assistant store: meetings, participants, minutes, action items, jobs.

SQLite over the JSON-file pattern team_store.py uses for tasks, because a
meeting record needs real relational queries a single-file scan can't answer
cheaply -- "which meetings did user X participate in" is the ACL requirement
itself, not a hypothetical future one.

Mirrors agent/tenancy/store.py's shape (plain module-level functions over a
sqlite3 connection, chmod'd 0600) rather than introducing an ORM, since that
is the existing convention for a small relational store in this codebase.

DB lives at ``<shared_root>/meetings.db`` -- shared_root() already resolves
per-org when multi-org routing is active (agent/tenancy/store.py's
platform.db is the one deliberate exception: it is process-global because it
is what *establishes* org identity in the first place). A meeting is an
org-scoped business record like a team, not per-Agent state, so it belongs
beside teams.json in the shared tier.

ACL model: before publish, a meeting is visible only to its organizer and org
admins -- participants are not notified of an unreviewed AI draft. Once
published, matched participants (a participant whose email matched a real
``agent.tenancy.store`` User) gain access too. An unmatched participant
(free-text name, no account) can appear in the record but cannot be granted
access through this mechanism -- see meetings.py's docstring for the
consequence.

On an instance with no real per-user accounts yet (``TenancyStore.has_any_user()``
is False), there is no per-user identity to check ACL against anywhere else in
the app either -- callers degrade to the app's existing binary
authenticated-or-401 trust boundary rather than inventing a parallel scheme.
That degrade decision lives in meetings.py (the caller), not here: this module
always enforces ACL when given a user_id, and callers decide when to pass one.
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

MEETING_STATUSES = ("draft", "processing", "review", "published")
JOB_STATUSES = ("queued", "running", "done", "failed")


def _db_path() -> Path:
    from common.state_dir import shared_root

    return shared_root() / "meetings.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
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
            logger.debug(f"[MeetingStore] chmod 0600 skipped: {e}")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            org_id TEXT,
            title TEXT NOT NULL,
            occurred_at REAL,
            organizer_user_id INTEGER,
            organizer_agent_id TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            summary TEXT,
            source_type TEXT,
            transcript_text TEXT,
            transcript_path TEXT,
            calendar_event_id TEXT,
            job_error TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    # Add-column migrations sort after the CREATE TABLE they alter (same rule
    # agent/tenancy/store.py's mfa_secret/mfa_enabled columns follow): a fresh
    # install gets these from the table never having existed without them, an
    # upgrade gets them bolted on here. Support for live bot-join capture
    # (agent/tools/meetings/live_capture.py) added after the original manual-
    # transcript-only schema shipped.
    meeting_cols = {row[1] for row in conn.execute("PRAGMA table_info(meetings)").fetchall()}
    if "meeting_url" not in meeting_cols:
        conn.execute("ALTER TABLE meetings ADD COLUMN meeting_url TEXT")
    if "capture_mode" not in meeting_cols:
        conn.execute("ALTER TABLE meetings ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'manual'")
    if "bot_id" not in meeting_cols:
        conn.execute("ALTER TABLE meetings ADD COLUMN bot_id TEXT")
    if "platform" not in meeting_cols:
        conn.execute("ALTER TABLE meetings ADD COLUMN platform TEXT")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            name TEXT,
            email TEXT,
            user_id INTEGER,
            is_invitee INTEGER NOT NULL DEFAULT 1,
            is_attendee INTEGER NOT NULL DEFAULT 0,
            evidence_span_idx INTEGER,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS transcript_spans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            idx INTEGER NOT NULL,
            start_ts TEXT,
            end_ts TEXT,
            speaker TEXT,
            text TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS minutes_sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            text TEXT NOT NULL,
            span_idx INTEGER,
            order_index INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS action_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            owner_user_id INTEGER,
            owner_name TEXT,
            owner_uncertain INTEGER NOT NULL DEFAULT 0,
            task TEXT NOT NULL,
            due_date TEXT,
            due_uncertain INTEGER NOT NULL DEFAULT 0,
            span_idx INTEGER,
            status TEXT NOT NULL DEFAULT 'open',
            created_at REAL NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            started_at REAL,
            ended_at REAL,
            error TEXT,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )
        """
    )
    conn.commit()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _row(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

def create_meeting(title: str, *, org_id: Optional[str], organizer_user_id: Optional[int],
                    organizer_agent_id: Optional[str], occurred_at: Optional[float] = None,
                    capture_mode: str = "manual", meeting_url: Optional[str] = None,
                    calendar_event_id: Optional[str] = None) -> Dict[str, Any]:
    if not title or not title.strip():
        raise ValueError("title is required")
    if capture_mode not in ("manual", "live_bot"):
        raise ValueError(f"invalid capture_mode: {capture_mode}")
    if capture_mode == "live_bot" and not meeting_url:
        raise ValueError("meeting_url is required for capture_mode='live_bot'")
    now = time.time()
    meeting = {
        "id": _new_id("meeting"),
        "org_id": org_id,
        "title": title.strip(),
        "occurred_at": occurred_at or now,
        "organizer_user_id": organizer_user_id,
        "organizer_agent_id": organizer_agent_id,
        "status": "draft",
        "summary": None,
        "source_type": None,
        "transcript_text": None,
        "transcript_path": None,
        "calendar_event_id": calendar_event_id,
        "job_error": None,
        "meeting_url": meeting_url,
        "capture_mode": capture_mode,
        "bot_id": None,
        "platform": None,
        "created_at": now,
        "updated_at": now,
    }
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                """INSERT INTO meetings
                   (id, org_id, title, occurred_at, organizer_user_id, organizer_agent_id,
                    status, summary, source_type, transcript_text, transcript_path,
                    calendar_event_id, job_error, meeting_url, capture_mode, bot_id, platform,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (meeting["id"], meeting["org_id"], meeting["title"], meeting["occurred_at"],
                 meeting["organizer_user_id"], meeting["organizer_agent_id"], meeting["status"],
                 meeting["summary"], meeting["source_type"], meeting["transcript_text"],
                 meeting["transcript_path"], meeting["calendar_event_id"], meeting["job_error"],
                 meeting["meeting_url"], meeting["capture_mode"], meeting["bot_id"], meeting["platform"],
                 meeting["created_at"], meeting["updated_at"]),
            )
            conn.commit()
        finally:
            conn.close()
    return meeting


def get_meeting(meeting_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


def _update_meeting_fields(meeting_id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(f"UPDATE meetings SET {cols} WHERE id = ?", (*fields.values(), meeting_id))
            conn.commit()
        finally:
            conn.close()


def update_meeting(meeting_id: str, **fields) -> Dict[str, Any]:
    """Organizer edits during review (title, summary, status transitions the
    caller has already validated). Not for status='published' -- use
    publish_meeting so the audit-relevant transition is explicit."""
    status = fields.get("status")
    if status is not None and status not in MEETING_STATUSES:
        raise ValueError(f"invalid status: {status}")
    if status == "published":
        raise ValueError("use publish_meeting() to publish, not update_meeting()")
    _update_meeting_fields(meeting_id, **fields)
    meeting = get_meeting(meeting_id)
    if meeting is None:
        raise ValueError(f"meeting '{meeting_id}' not found")
    return meeting


def publish_meeting(meeting_id: str) -> Dict[str, Any]:
    meeting = get_meeting(meeting_id)
    if meeting is None:
        raise ValueError(f"meeting '{meeting_id}' not found")
    if meeting["status"] != "review":
        raise ValueError("only a meeting in 'review' can be published")
    _update_meeting_fields(meeting_id, status="published")
    return get_meeting(meeting_id)


def list_meetings(org_id: Optional[str], user_id: Optional[int], is_org_admin: bool) -> List[Dict[str, Any]]:
    """Every meeting ``user_id`` (None = legacy no-account install, unfiltered
    within the org) can see, newest first. Filtering happens in Python over
    can_view() rather than SQL, since visibility depends on a per-meeting
    participant join the caller doesn't need to see the shape of."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM meetings WHERE org_id IS ? ORDER BY updated_at DESC", (org_id,)
        ).fetchall()
    finally:
        conn.close()
    meetings = [_row(r) for r in rows]
    if user_id is None:
        return meetings
    return [m for m in meetings if can_view(m, user_id, is_org_admin)]


def can_view(meeting: Dict[str, Any], user_id: Optional[int], is_org_admin: bool) -> bool:
    """Per-resource ACL. A meeting not yet published is visible only to its
    organizer and org admins -- participants are not shown an unreviewed AI
    draft. Once published, a matched participant (real account, see
    add_participants) gains access too."""
    if user_id is None:
        return True
    if is_org_admin:
        return True
    if meeting.get("organizer_user_id") == user_id:
        return True
    if meeting.get("status") != "published":
        return False
    return user_id in {p["user_id"] for p in list_participants(meeting["id"]) if p.get("user_id") is not None}


# ---------------------------------------------------------------------------
# Participants
# ---------------------------------------------------------------------------

def add_participants(meeting_id: str, people: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """``people`` is ``[{"name": ..., "email": ...}, ...]``. Each is matched
    against ``agent.tenancy.store``'s User table by email (case-insensitive,
    same normalization TenancyStore.create_user/get_user_by_email use) where
    a matching org membership exists; unmatched entries are kept as
    free-text-only (no ``user_id``, cannot be ACL-granted). Replaces the
    meeting's existing invitee list; call once at creation/edit time, not
    incrementally."""
    meeting = get_meeting(meeting_id)
    if meeting is None:
        raise ValueError(f"meeting '{meeting_id}' not found")

    matched = []
    try:
        from agent.tenancy.store import get_tenancy_store

        store = get_tenancy_store()
    except Exception as e:
        logger.warning(f"[MeetingStore] tenancy store unavailable, participants stay unmatched: {e}")
        store = None

    org_id_int = None
    if store is not None and meeting.get("org_id") is not None:
        try:
            org_id_int = int(meeting["org_id"])
        except (TypeError, ValueError):
            org_id_int = None

    for person in people:
        name = str(person.get("name") or "").strip()
        email = str(person.get("email") or "").strip().lower() or None
        user_id = None
        if store is not None and email:
            user = store.get_user_by_email(email)
            # A matched account only grants access if it actually belongs to
            # this meeting's org -- an email collision with an account in a
            # different org on a shared instance must never widen ACL across
            # tenants (see the SC-IDOR note this file's header expands on).
            if user is not None and org_id_int is not None and store.has_role(user.id, org_id_int, "member"):
                user_id = user.id
                if not name:
                    name = email
        matched.append({"name": name or email or "", "email": email, "user_id": user_id})

    with _LOCK:
        conn = _connect()
        try:
            conn.execute("DELETE FROM participants WHERE meeting_id = ?", (meeting_id,))
            for person in matched:
                conn.execute(
                    """INSERT INTO participants (meeting_id, name, email, user_id, is_invitee, is_attendee)
                       VALUES (?,?,?,?,1,0)""",
                    (meeting_id, person["name"], person["email"], person["user_id"]),
                )
            conn.commit()
        finally:
            conn.close()
    return list_participants(meeting_id)


def list_participants(meeting_id: str) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM participants WHERE meeting_id = ? ORDER BY id", (meeting_id,)
        ).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def set_attendance(meeting_id: str, participant_id: int, is_attendee: bool,
                    evidence_span_idx: Optional[int] = None) -> None:
    """Attendance is evidence-based and separate from invitee status (never
    inferred from an invite alone) -- set by the extraction job when the
    transcript supports someone's presence, or by the organizer during
    review."""
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                "UPDATE participants SET is_attendee = ?, evidence_span_idx = ? "
                "WHERE id = ? AND meeting_id = ?",
                (1 if is_attendee else 0, evidence_span_idx, participant_id, meeting_id),
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------

def save_transcript(meeting_id: str, *, source_type: str, text: str,
                     spans: List[Dict[str, Any]], transcript_path: Optional[str] = None) -> None:
    """Persists the raw transcript text plus its parsed spans, and moves the
    meeting to 'processing'. Called once per upload -- a re-upload replaces
    the prior transcript and spans outright."""
    with _LOCK:
        conn = _connect()
        try:
            conn.execute("DELETE FROM transcript_spans WHERE meeting_id = ?", (meeting_id,))
            for span in spans:
                conn.execute(
                    """INSERT INTO transcript_spans (meeting_id, idx, start_ts, end_ts, speaker, text)
                       VALUES (?,?,?,?,?,?)""",
                    (meeting_id, span["idx"], span.get("start_ts"), span.get("end_ts"),
                     span.get("speaker"), span["text"]),
                )
            conn.execute(
                "UPDATE meetings SET source_type = ?, transcript_text = ?, transcript_path = ?, "
                "status = 'processing', job_error = NULL, updated_at = ? WHERE id = ?",
                (source_type, text, transcript_path, time.time(), meeting_id),
            )
            conn.commit()
        finally:
            conn.close()


def get_transcript_spans(meeting_id: str) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM transcript_spans WHERE meeting_id = ? ORDER BY idx", (meeting_id,)
        ).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Extraction results (minutes, decisions, open questions, action items)
# ---------------------------------------------------------------------------

def save_extraction_result(meeting_id: str, *, summary: str,
                            decisions: List[Dict[str, Any]],
                            open_questions: List[Dict[str, Any]],
                            action_items: List[Dict[str, Any]],
                            attendance: List[Dict[str, Any]]) -> None:
    """Writes the AI extraction's output and moves the meeting to 'review'.
    Never moves it to 'published' -- that is only ever an explicit organizer
    action via publish_meeting(). ``decisions``/``open_questions`` are
    ``[{"text":..., "span_idx": int|None}]``; ``action_items`` are
    ``[{"owner_user_id": int|None, "owner_name": str|None, "owner_uncertain": bool,
    "task": str, "due_date": str|None, "due_uncertain": bool, "span_idx": int|None}]``;
    ``attendance`` is ``[{"participant_id": int, "evidence_span_idx": int|None}]``
    for participants the transcript evidence supports as present -- everyone
    else keeps is_attendee=0, i.e. invited but not shown as attended."""
    now = time.time()
    with _LOCK:
        conn = _connect()
        try:
            conn.execute("DELETE FROM minutes_sections WHERE meeting_id = ?", (meeting_id,))
            order_index = 0
            for item in decisions:
                conn.execute(
                    "INSERT INTO minutes_sections (meeting_id, kind, text, span_idx, order_index) "
                    "VALUES (?, 'decision', ?, ?, ?)",
                    (meeting_id, item["text"], item.get("span_idx"), order_index),
                )
                order_index += 1
            for item in open_questions:
                conn.execute(
                    "INSERT INTO minutes_sections (meeting_id, kind, text, span_idx, order_index) "
                    "VALUES (?, 'open_question', ?, ?, ?)",
                    (meeting_id, item["text"], item.get("span_idx"), order_index),
                )
                order_index += 1

            conn.execute("DELETE FROM action_items WHERE meeting_id = ?", (meeting_id,))
            for item in action_items:
                conn.execute(
                    """INSERT INTO action_items
                       (meeting_id, owner_user_id, owner_name, owner_uncertain, task,
                        due_date, due_uncertain, span_idx, status, created_at)
                       VALUES (?,?,?,?,?,?,?,?,'open',?)""",
                    (meeting_id, item.get("owner_user_id"), item.get("owner_name"),
                     1 if item.get("owner_uncertain") else 0, item["task"],
                     item.get("due_date"), 1 if item.get("due_uncertain") else 0,
                     item.get("span_idx"), now),
                )

            for entry in attendance:
                conn.execute(
                    "UPDATE participants SET is_attendee = 1, evidence_span_idx = ? "
                    "WHERE id = ? AND meeting_id = ?",
                    (entry.get("evidence_span_idx"), entry["participant_id"], meeting_id),
                )

            conn.execute(
                "UPDATE meetings SET summary = ?, status = 'review', job_error = NULL, updated_at = ? WHERE id = ?",
                (summary, now, meeting_id),
            )
            conn.commit()
        finally:
            conn.close()


def list_minutes_sections(meeting_id: str, kind: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        if kind:
            rows = conn.execute(
                "SELECT * FROM minutes_sections WHERE meeting_id = ? AND kind = ? ORDER BY order_index",
                (meeting_id, kind),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM minutes_sections WHERE meeting_id = ? ORDER BY order_index", (meeting_id,)
            ).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def list_action_items(meeting_id: str) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM action_items WHERE meeting_id = ? ORDER BY id", (meeting_id,)
        ).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def update_action_item(meeting_id: str, item_id: int, **fields) -> Dict[str, Any]:
    """Organizer resolving an uncertain owner/date, or marking one done."""
    if not fields:
        raise ValueError("no fields to update")
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                f"UPDATE action_items SET {cols} WHERE id = ? AND meeting_id = ?",
                (*fields.values(), item_id, meeting_id),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM action_items WHERE id = ? AND meeting_id = ?", (item_id, meeting_id)
            ).fetchone()
        finally:
            conn.close()
    if row is None:
        raise ValueError(f"action item '{item_id}' not found on meeting '{meeting_id}'")
    return _row(row)


# ---------------------------------------------------------------------------
# Jobs (transcript -> extraction background work)
# ---------------------------------------------------------------------------

def create_job(meeting_id: str, kind: str) -> Dict[str, Any]:
    job = {
        "id": _new_id("job"),
        "meeting_id": meeting_id,
        "kind": kind,
        "status": "queued",
        "started_at": None,
        "ended_at": None,
        "error": None,
    }
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO jobs (id, meeting_id, kind, status) VALUES (?,?,?,?)",
                (job["id"], job["meeting_id"], job["kind"], job["status"]),
            )
            conn.commit()
        finally:
            conn.close()
    return job


def update_job(job_id: str, **fields) -> None:
    if fields.get("status") is not None and fields["status"] not in JOB_STATUSES:
        raise ValueError(f"invalid job status: {fields['status']}")
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))
            conn.commit()
        finally:
            conn.close()


def latest_job_for_meeting(meeting_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM jobs WHERE meeting_id = ? ORDER BY rowid DESC LIMIT 1", (meeting_id,)
        ).fetchone()
        return _row(row) if row else None
    finally:
        conn.close()


def sweep_stalled_jobs() -> int:
    """Call once at process startup. A job still 'running' cannot be real --
    the thread that would finish it dies with the process, same reasoning
    autopilot.sync_running_teams() uses to only ever *restart* known-durable
    state, never assume an in-memory thread survived. Marks each as failed so
    the meeting stays discoverable in the UI with a manual "reprocess"
    affordance instead of silently stuck in 'processing' forever. Returns the
    number of jobs swept."""
    now = time.time()
    with _LOCK:
        conn = _connect()
        try:
            stuck = conn.execute("SELECT id, meeting_id FROM jobs WHERE status = 'running'").fetchall()
            for row in stuck:
                conn.execute(
                    "UPDATE jobs SET status = 'failed', error = ?, ended_at = ? WHERE id = ?",
                    ("Interrupted by a restart before it finished.", now, row["id"]),
                )
                conn.execute(
                    "UPDATE meetings SET job_error = ?, updated_at = ? WHERE id = ?",
                    ("Interrupted by a restart before it finished. Use Reprocess to try again.",
                     now, row["meeting_id"]),
                )
            conn.commit()
        finally:
            conn.close()
    if stuck:
        logger.info(f"[MeetingStore] Swept {len(stuck)} stalled job(s) after restart")
    return len(stuck)


# ---------------------------------------------------------------------------
# Live bot-join capture (agent/tools/meetings/live_capture.py,
# agent/tools/meetings/calendar_watch.py)
# ---------------------------------------------------------------------------

def list_due_live_captures(lookahead_seconds: float, org_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Meetings opted into bot capture (capture_mode='live_bot') whose start
    time has arrived within the lookahead window and that have not been sent
    a bot yet, scoped to ``org_id`` (the calendar-watch service loops one org
    at a time, since each org has its own Composio/Recall.ai connection --
    never send a bot using one org's connection for another org's meeting).
    Recall.ai requires ``join_at`` at least 10 minutes in advance, so the
    caller's lookahead should stay at or above that. Excludes meetings whose
    start time is already well in the past (a join_at that has already
    elapsed would fail at Recall.ai's end anyway) -- same "skip a stale tick
    rather than fire late" reasoning scheduler_service.py's own catch-up
    window uses."""
    now = time.time()
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM meetings WHERE capture_mode = 'live_bot' AND bot_id IS NULL "
            "AND status = 'draft' AND org_id IS ? AND occurred_at >= ? AND occurred_at <= ?",
            (org_id, now - 600, now + lookahead_seconds),
        ).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def set_bot_id(meeting_id: str, bot_id: str, platform: Optional[str] = None) -> None:
    _update_meeting_fields(meeting_id, bot_id=bot_id, platform=platform)


def list_meetings_with_active_bot(org_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Meetings with a bot sent but no transcript yet, scoped to ``org_id``
    for the same reason list_due_live_captures is -- the calendar-watch
    service polls each of these for the bot's status until it either
    produces a transcript (-> save_transcript, same as a manual upload) or
    fails."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM meetings WHERE capture_mode = 'live_bot' AND bot_id IS NOT NULL "
            "AND status = 'draft' AND org_id IS ?",
            (org_id,),
        ).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def list_org_ids_with_live_captures() -> List[Optional[str]]:
    """Distinct org_ids that have at least one meeting in a live-capture
    state (pending bot dispatch or awaiting transcript) -- the calendar-watch
    service's outer loop, so it only does work for orgs that actually opted
    into bot capture rather than scanning every org on every tick."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT DISTINCT org_id FROM meetings WHERE capture_mode = 'live_bot' AND status = 'draft'"
        ).fetchall()
        return [r["org_id"] for r in rows]
    finally:
        conn.close()
