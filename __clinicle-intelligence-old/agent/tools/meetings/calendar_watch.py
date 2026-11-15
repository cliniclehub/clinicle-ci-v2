"""Background service: sends Recall.ai bots to meetings the organizer opted
into live capture, and polls sent bots until a transcript is ready.

A meeting only ever enters this path by explicit organizer action (see
channel/web/api/meetings.py's UpcomingMeetingsHandler.POST) -- there is no
blanket "join every calendar event" behavior. A bot visibly joins a call as
a participant, and recording-consent rules vary by jurisdiction, so silent
blanket automation is not something this module does.

Same threading.Thread + sleep-loop shape as
agent/tools/scheduler/scheduler_service.py's SchedulerService, but a single
process-wide instance (not one per task) since there is one thing to watch --
every org's due live-capture meetings -- not N independently-scheduled tasks.
Polling, not webhooks (2026-09-24 decision: this instance may not have a
public HTTPS endpoint for Recall.ai to push to).
"""

from __future__ import annotations

import threading
import time
from typing import Optional

from common.log import logger
from common.runtime_identity import RuntimeIdentity, use_identity

from agent.tools.meetings import job_runner, live_capture
from agent.workspace import meeting_store

# Recall.ai needs join_at at least 10 minutes ahead; look further out than
# that so a meeting starting in, say, 12 minutes is caught well before its
# join_at would become invalid on the next tick.
_LOOKAHEAD_SECONDS = 20 * 60
_TICK_SECONDS = 60


class CalendarWatchService:
    def __init__(self):
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="calendar-watch")
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run_loop(self) -> None:
        logger.info("[CalendarWatch] started")
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as e:
                logger.error(f"[CalendarWatch] tick failed: {e}")
            self._stop_event.wait(_TICK_SECONDS)
        logger.info("[CalendarWatch] stopped")

    def _tick(self) -> None:
        for org_id in meeting_store.list_org_ids_with_live_captures():
            with use_identity(RuntimeIdentity(org_id=org_id)):
                self._dispatch_due_bots(org_id)
                self._poll_active_bots(org_id)

    def _dispatch_due_bots(self, org_id) -> None:
        for meeting in meeting_store.list_due_live_captures(_LOOKAHEAD_SECONDS, org_id=org_id):
            try:
                bot = live_capture.create_bot(
                    meeting["meeting_url"], join_at=meeting["occurred_at"],
                    bot_name=f'Notetaker · {meeting["title"]}'[:100],
                )
                platform = live_capture.guess_platform(meeting["meeting_url"])
                meeting_store.set_bot_id(meeting["id"], bot["id"], platform=platform)
                logger.info(f"[CalendarWatch] sent bot {bot['id']} to meeting {meeting['id']} ({platform})")
            except Exception as e:
                logger.warning(f"[CalendarWatch] could not send bot for meeting {meeting['id']}: {e}")
                try:
                    meeting_store.update_meeting(meeting["id"], job_error=str(e))
                except Exception as inner:
                    logger.warning(f"[CalendarWatch] could not record job_error on {meeting['id']}: {inner}")

    def _poll_active_bots(self, org_id) -> None:
        for meeting in meeting_store.list_meetings_with_active_bot(org_id=org_id):
            try:
                bot = live_capture.retrieve_bot(meeting["bot_id"])
                phase = live_capture.bot_phase(bot)
                if phase == "pending":
                    continue
                if phase == "failed":
                    meeting_store.update_meeting(
                        meeting["id"], job_error="The Recall.ai bot could not complete the call capture.",
                    )
                    continue
                # phase == "done"
                spans = live_capture.fetch_transcript_spans(bot)
                text = "\n\n".join(s["text"] for s in spans)
                meeting_store.save_transcript(meeting["id"], source_type="live_bot", text=text, spans=spans)
                job_runner.start_extraction_job(meeting["id"])
                logger.info(f"[CalendarWatch] meeting {meeting['id']}: transcript captured, extraction started")
            except Exception as e:
                logger.warning(f"[CalendarWatch] could not process bot for meeting {meeting['id']}: {e}")
                try:
                    meeting_store.update_meeting(meeting["id"], job_error=str(e))
                except Exception as inner:
                    logger.warning(f"[CalendarWatch] could not record job_error on {meeting['id']}: {inner}")


_service: Optional[CalendarWatchService] = None
_service_lock = threading.Lock()


def get_calendar_watch_service() -> CalendarWatchService:
    global _service
    with _service_lock:
        if _service is None:
            _service = CalendarWatchService()
        return _service
