"""Tests for calendar_sources.py's event normalization and cross-source
failure isolation -- Outlook's parameters are unverified (see module
docstring), so a broken Outlook call must never take down Google Calendar
results in the merged view."""

from unittest.mock import patch

from agent.tools.meetings import calendar_sources as cs


class _Result:
    def __init__(self, status="success", result=None):
        self.status = status
        self.result = result


def test_google_events_parsed_with_meeting_url_and_all_day():
    payload = {"items": [
        {"id": "g1", "summary": "Standup", "start": {"dateTime": "2026-09-25T09:00:00Z"},
         "end": {"dateTime": "2026-09-25T09:30:00Z"},
         "conferenceData": {"entryPoints": [{"entryPointType": "video", "uri": "https://meet.google.com/abc"}]},
         "attendees": [{"email": "a@x.com", "displayName": "A"}]},
        {"id": "g2", "summary": "All day", "start": {"date": "2026-09-26"}, "end": {"date": "2026-09-27"}},
    ]}
    with patch.object(cs, "_call", return_value=_Result(result=payload)):
        events = cs.list_google_events(0, 9999999999)
    assert len(events) == 2
    assert events[0]["meeting_url"] == "https://meet.google.com/abc"
    assert events[0]["attendees"] == [{"name": "A", "email": "a@x.com"}]
    assert events[1]["all_day"] is True


def test_outlook_events_parsed():
    payload = {"value": [
        {"id": "o1", "subject": "1:1", "start": {"dateTime": "2026-09-25T10:00:00"},
         "end": {"dateTime": "2026-09-25T10:30:00"},
         "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/l/x"},
         "attendees": [{"emailAddress": {"address": "b@x.com", "name": "B"}}]},
    ]}
    with patch.object(cs, "_call", return_value=_Result(result=payload)):
        events = cs.list_outlook_events(0, 9999999999)
    assert len(events) == 1
    assert events[0]["source"] == "outlook"
    assert events[0]["meeting_url"] == "https://teams.microsoft.com/l/x"


def test_outlook_failure_does_not_break_merged_view():
    with patch.object(cs, "list_google_events", return_value=[{"starts_at": 5.0, "source": "google"}]), \
         patch.object(cs, "_call", side_effect=RuntimeError("Outlook not connected")):
        merged = cs.list_all_events(0, 9999999999)
    assert len(merged) == 1
    assert merged[0]["source"] == "google"


def test_google_failure_does_not_break_merged_view():
    with patch.object(cs, "list_outlook_events", return_value=[{"starts_at": 5.0, "source": "outlook"}]), \
         patch.object(cs, "_call", side_effect=RuntimeError("Google Calendar not connected")):
        merged = cs.list_all_events(0, 9999999999)
    assert len(merged) == 1
    assert merged[0]["source"] == "outlook"


def test_merged_events_sorted_by_start():
    google_events = [{"starts_at": 20.0, "source": "google"}]
    outlook_events = [{"starts_at": 5.0, "source": "outlook"}]
    with patch.object(cs, "list_google_events", return_value=google_events), \
         patch.object(cs, "list_outlook_events", return_value=outlook_events):
        merged = cs.list_all_events(0, 9999999999)
    assert [e["source"] for e in merged] == ["outlook", "google"]
