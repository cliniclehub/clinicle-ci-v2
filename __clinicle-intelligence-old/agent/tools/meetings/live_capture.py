"""Live bot-join capture via Composio's Recall.ai toolkit
(``RECALLAI_*`` tool slugs) -- sends a bot into a Zoom/Google Meet/Microsoft
Teams/Webex call from a meeting URL, and once the call ends, pulls the
transcript into the exact same ingest -> extraction pipeline a manual
paste/upload already uses (``meeting_store.save_transcript`` +
``job_runner.start_extraction_job``). No new AI logic here -- this module's
only job is turning "a bot joined a call" into "a transcript exists".

Connecting Recall.ai itself needs no new code: it is an API-key-only
Composio app, and channel/web/api/connectors.py's existing
ConnectorSessionHandler already handles API-key apps through the same
"search catalog -> Connect" flow every OAuth app uses.

IMPORTANT -- verify against a live account before relying on this in
production: Recall.ai's exact ``RECALLAI_RETRIEVE_BOT``/``RECALLAI_LIST_TRANSCRIPT``
response shapes were not fully documented in what I could research (no live
Recall.ai account exists in this environment to confirm against). The parsing
below is defensive -- it tries several plausible field names and raises a
clear error rather than silently producing a malformed transcript -- but
should be checked against one real response and tightened once an account
exists.

Zoom needs its own OAuth app registered with Recall.ai first
(RECALLAI_CREATE_ZOOM_OAUTH_APP, see channel/web/api/meetings.py's
RecallaiSetupHandler); Google Meet needs a login group + SSO cert
(RECALLAI_CREATE_GOOGLE_LOGIN_GROUP / RECALLAI_CREATE_GOOGLE_LOGIN); Microsoft
Teams and Webex need nothing beyond the meeting URL. A bot sent to an
unconfigured platform fails at Recall.ai's end with a clear error, surfaced
here as the job's error message.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from common.log import logger

_PLATFORM_HINTS = (
    ("zoom.us", "zoom"),
    ("meet.google.com", "google_meet"),
    ("teams.microsoft.com", "teams"),
    ("teams.live.com", "teams"),
    ("webex.com", "webex"),
)

# Recall.ai requires join_at at least 10 minutes in the future; pad slightly
# so a bot dispatched right at the boundary (clock skew, request latency)
# doesn't get rejected.
_MIN_JOIN_LEAD_SECONDS = 11 * 60


def guess_platform(meeting_url: str) -> Optional[str]:
    url_l = (meeting_url or "").lower()
    for needle, platform in _PLATFORM_HINTS:
        if needle in url_l:
            return platform
    return None


def _call(tool_slug: str, arguments: Dict[str, Any]):
    from agent.tools.connectors.connector_call import ConnectorCallTool

    return ConnectorCallTool().execute({"tool_slug": tool_slug, "arguments": arguments})


def create_bot(meeting_url: str, *, join_at: Optional[float] = None,
                bot_name: str = "Meeting Notetaker") -> Dict[str, Any]:
    """Sends a bot to ``meeting_url``. ``join_at`` is a unix timestamp; if
    given, it is pushed out to Recall.ai's minimum lead time rather than
    silently failing on a too-soon request. Returns the raw bot dict on
    success; raises RuntimeError with Recall.ai's own message on failure."""
    arguments: Dict[str, Any] = {"meeting_url": meeting_url, "bot_name": bot_name[:100]}
    if join_at is not None:
        import time as _time

        earliest = _time.time() + _MIN_JOIN_LEAD_SECONDS
        join_at = max(join_at, earliest)
        arguments["join_at"] = datetime.fromtimestamp(join_at, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    result = _call("RECALLAI_CREATE_BOT", arguments)
    if result.status != "success":
        raise RuntimeError(f"Recall.ai could not create a bot: {result.result}")
    bot = result.result or {}
    if not bot.get("id"):
        raise RuntimeError(f"Recall.ai's create-bot response had no bot id: {bot}")
    return bot


def retrieve_bot(bot_id: str) -> Dict[str, Any]:
    result = _call("RECALLAI_RETRIEVE_BOT", {"id": bot_id})
    if result.status != "success":
        raise RuntimeError(f"Recall.ai could not retrieve bot {bot_id}: {result.result}")
    return result.result or {}


_DONE_STATUS_HINTS = {"done", "call_ended", "completed", "analysis_done"}
_FAILED_STATUS_HINTS = {"error", "fatal", "call_ended_no_recording"}


def bot_phase(bot: Dict[str, Any]) -> str:
    """Best-effort classification of a bot's lifecycle from whatever status
    field the response actually has (``status``, or the last entry of a
    ``status_changes`` list -- both shapes are mentioned across Recall.ai's
    docs; this covers either without assuming one is authoritative). Returns
    one of 'pending', 'done', 'failed'."""
    status = str(bot.get("status") or "").lower()
    if not status:
        changes = bot.get("status_changes") or []
        if changes and isinstance(changes, list):
            last = changes[-1]
            status = str((last.get("code") if isinstance(last, dict) else last) or "").lower()
    if any(hint in status for hint in _FAILED_STATUS_HINTS):
        return "failed"
    if any(hint in status for hint in _DONE_STATUS_HINTS):
        return "done"
    return "pending"


def _first_recording_id(bot: Dict[str, Any]) -> Optional[str]:
    recordings = bot.get("recordings") or []
    if recordings and isinstance(recordings, list):
        first = recordings[0]
        return first.get("id") if isinstance(first, dict) else str(first)
    return None


def fetch_transcript_spans(bot: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pulls the transcript for a done bot's recording and maps it into this
    app's span shape. Raises RuntimeError if the response doesn't match any
    of the field names this defensively checks for -- see this module's
    docstring on why that is intentional rather than a bug to silently paper
    over."""
    recording_id = _first_recording_id(bot)
    if not recording_id:
        raise RuntimeError("bot finished with no recording -- nothing to transcribe")

    result = _call("RECALLAI_LIST_TRANSCRIPT", {"recording_id": recording_id})
    if result.status != "success":
        raise RuntimeError(f"Recall.ai could not list the transcript: {result.result}")

    raw = result.result
    entries = raw.get("results") if isinstance(raw, dict) else raw
    if not isinstance(entries, list) or not entries:
        raise RuntimeError("Recall.ai returned an empty or unrecognized transcript response")

    spans: List[Dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        text = entry.get("text") or entry.get("transcript") or ""
        if not text and isinstance(entry.get("words"), list):
            text = " ".join(str(w.get("text", w)) for w in entry["words"] if w)
        text = str(text).strip()
        if not text:
            continue
        speaker_field = entry.get("speaker")
        if isinstance(speaker_field, dict):
            speaker = speaker_field.get("name")
        else:
            speaker = speaker_field or entry.get("participant") or entry.get("participant_name")
        start = entry.get("start_time") or entry.get("start") or entry.get("timestamp")
        spans.append({
            "idx": len(spans),
            "start_ts": str(start) if start is not None else None,
            "end_ts": None,
            "speaker": str(speaker) if speaker else None,
            "text": text,
        })

    if not spans:
        raise RuntimeError("Recall.ai's transcript had entries but none contained recognizable text")
    return spans


def remove_bot(bot_id: str) -> None:
    """Best-effort immediate disconnect, e.g. if an organizer cancels a
    scheduled capture. Never raises -- a failed remove leaves the bot to
    finish on its own, which is safe, just not instant."""
    try:
        _call("RECALLAI_REMOVE_BOT_FROM_CALL", {"id": bot_id})
    except Exception as e:
        logger.warning(f"[LiveCapture] remove_bot({bot_id}) failed: {e}")
