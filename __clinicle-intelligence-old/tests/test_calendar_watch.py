"""Tests for CalendarWatchService's tick: dispatching due bots and polling
active ones, staying org-scoped throughout (a bot must never be sent, and a
transcript never attributed, using a different org's identity/connection)."""

import time
from unittest.mock import patch

import pytest

from agent.tools.meetings import calendar_watch, job_runner
from agent.workspace import meeting_store as ms


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ms, "_db_path", lambda: tmp_path / "meetings.db")


def test_dispatch_due_bots_sets_bot_id_on_success():
    meeting = ms.create_meeting(
        "Standup", org_id="1", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/123", occurred_at=time.time() + 300,
    )
    service = calendar_watch.CalendarWatchService()

    with patch("agent.tools.meetings.live_capture.create_bot", return_value={"id": "bot-1"}) as mock_create:
        service._dispatch_due_bots("1")

    mock_create.assert_called_once()
    updated = ms.get_meeting(meeting["id"])
    assert updated["bot_id"] == "bot-1"
    assert updated["platform"] == "zoom"


def test_dispatch_due_bots_records_error_without_crashing_other_meetings():
    m1 = ms.create_meeting(
        "Bad one", org_id="1", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/1", occurred_at=time.time() + 300,
    )
    m2 = ms.create_meeting(
        "Good one", org_id="1", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/2", occurred_at=time.time() + 300,
    )
    service = calendar_watch.CalendarWatchService()

    def _create_bot(meeting_url, **kwargs):
        if "j/1" in meeting_url:
            raise RuntimeError("Zoom app not configured")
        return {"id": "bot-2"}

    with patch("agent.tools.meetings.live_capture.create_bot", side_effect=_create_bot):
        service._dispatch_due_bots("1")

    assert ms.get_meeting(m1["id"])["job_error"] == "Zoom app not configured"
    assert ms.get_meeting(m2["id"])["bot_id"] == "bot-2"


def test_poll_active_bots_done_saves_transcript_and_starts_extraction():
    meeting = ms.create_meeting(
        "Standup", org_id="1", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/123", occurred_at=time.time() - 60,
    )
    ms.set_bot_id(meeting["id"], "bot-1", platform="zoom")
    service = calendar_watch.CalendarWatchService()

    spans = [{"idx": 0, "start_ts": None, "end_ts": None, "speaker": "Alice", "text": "Ship Friday."}]
    with patch("agent.tools.meetings.live_capture.retrieve_bot", return_value={"status": "done"}), \
         patch("agent.tools.meetings.live_capture.bot_phase", return_value="done"), \
         patch("agent.tools.meetings.live_capture.fetch_transcript_spans", return_value=spans), \
         patch.object(job_runner, "start_extraction_job") as mock_start_job:
        service._poll_active_bots("1")

    mock_start_job.assert_called_once_with(meeting["id"])
    updated = ms.get_meeting(meeting["id"])
    assert updated["status"] == "processing"
    assert updated["transcript_text"] == "Ship Friday."


def test_poll_active_bots_failed_records_error():
    meeting = ms.create_meeting(
        "Standup", org_id="1", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/123", occurred_at=time.time() - 60,
    )
    ms.set_bot_id(meeting["id"], "bot-1", platform="zoom")
    service = calendar_watch.CalendarWatchService()

    with patch("agent.tools.meetings.live_capture.retrieve_bot", return_value={"status": "fatal_error"}), \
         patch("agent.tools.meetings.live_capture.bot_phase", return_value="failed"):
        service._poll_active_bots("1")

    updated = ms.get_meeting(meeting["id"])
    assert updated["status"] == "draft"  # never silently moved forward on failure
    assert "could not complete" in updated["job_error"].lower()


def test_org_scoping_never_crosses(monkeypatch):
    """A meeting in org '2' must never be touched by a tick scoped to org '1'."""
    ms.create_meeting(
        "Org 2 meeting", org_id="2", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/999", occurred_at=time.time() + 300,
    )
    service = calendar_watch.CalendarWatchService()

    with patch("agent.tools.meetings.live_capture.create_bot") as mock_create:
        service._dispatch_due_bots("1")

    mock_create.assert_not_called()
