"""Runs one meeting's transcript -> extraction job on a background thread.

One ``threading.Thread(daemon=True)`` per upload -- the same primitive
``agent/tools/team/autopilot.py`` uses per team, not scheduler_service.py's
cron/interval machinery, since this fires exactly once per upload and has no
"next run" to compute. Crash recovery is meeting_store.sweep_stalled_jobs()
at process startup (see channel/web/web_channel.py's build_app), which marks
any job still 'running' as failed -- a thread cannot survive a restart, so a
'running' row found at startup is definitionally stale.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, Optional

from common.log import logger
from common.runtime_identity import RuntimeIdentity, use_identity

from agent.tools.meetings.extraction_service import extract
from agent.workspace import meeting_store

# In-memory phase, for the review UI's "processing..." poll -- same idea as
# autopilot._status: coarse, not token-level, since a job is one blocking
# model call with no on_event hook to report anything finer.
_status: Dict[str, dict] = {}
_status_lock = threading.Lock()


def get_status(meeting_id: str) -> Optional[dict]:
    with _status_lock:
        status = _status.get(meeting_id)
        return dict(status) if status else None


def _set_status(meeting_id: str, **fields) -> None:
    with _status_lock:
        _status[meeting_id] = fields


def _clear_status(meeting_id: str) -> None:
    with _status_lock:
        _status.pop(meeting_id, None)


def start_extraction_job(meeting_id: str) -> None:
    """Fire the background job. Call right after meeting_store.save_transcript()
    has moved the meeting to 'processing'."""
    meeting = meeting_store.get_meeting(meeting_id)
    if meeting is None:
        raise ValueError(f"meeting '{meeting_id}' not found")
    org_id = meeting.get("org_id")
    agent_id = meeting.get("organizer_agent_id")
    thread = threading.Thread(
        target=_run_job, args=(meeting_id, org_id, agent_id),
        daemon=True, name=f"meeting-extract-{meeting_id}",
    )
    thread.start()


def _run_job(meeting_id: str, org_id: Optional[str], agent_id: Optional[str]) -> None:
    """Runs off the request thread, so the ambient RuntimeIdentity a normal
    request gets from _identity_processor is gone -- reconstruct the org/agent
    scoping explicitly here (see common/runtime_identity.py's own note that
    ContextVars don't cross thread boundaries on their own)."""
    with use_identity(RuntimeIdentity(org_id=org_id, agent_id=agent_id)):
        job = meeting_store.create_job(meeting_id, "extract")
        meeting_store.update_job(job["id"], status="running", started_at=time.time())
        _set_status(meeting_id, phase="extracting", started_at=time.time())
        try:
            meeting = meeting_store.get_meeting(meeting_id)
            if meeting is None:
                raise RuntimeError("meeting disappeared before extraction ran")
            spans = meeting_store.get_transcript_spans(meeting_id)
            participants = meeting_store.list_participants(meeting_id)
            if not spans:
                raise RuntimeError("no transcript spans to extract from")

            result = extract(meeting, spans, participants)
            meeting_store.save_extraction_result(meeting_id, **result)
            meeting_store.update_job(job["id"], status="done", ended_at=time.time())
            logger.info(f"[MeetingExtraction] meeting {meeting_id}: extraction complete, now in review")
        except Exception as e:
            logger.error(f"[MeetingExtraction] meeting {meeting_id} failed: {e}")
            meeting_store.update_job(job["id"], status="failed", error=str(e), ended_at=time.time())
            try:
                meeting_store.update_meeting(meeting_id, job_error=str(e))
            except Exception as inner:
                logger.warning(f"[MeetingExtraction] could not record job_error on meeting {meeting_id}: {inner}")
        finally:
            _clear_status(meeting_id)


def reprocess(meeting_id: str) -> None:
    """Manual retry for a meeting stuck in 'processing' with a job_error (a
    crash, or a failed extraction). Reruns against the already-stored
    transcript spans -- no re-upload needed."""
    meeting = meeting_store.get_meeting(meeting_id)
    if meeting is None:
        raise ValueError(f"meeting '{meeting_id}' not found")
    if meeting["status"] != "processing":
        raise ValueError("only a meeting stuck in 'processing' can be reprocessed")
    start_extraction_job(meeting_id)
