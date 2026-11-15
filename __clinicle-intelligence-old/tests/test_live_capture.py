"""Tests for the Recall.ai live-capture helpers: platform detection, bot
phase classification, and transcript parsing. These are the pieces with no
live Recall.ai account to verify against in this environment -- see
agent/tools/meetings/live_capture.py's module docstring -- so the tests lock
in the defensive-parsing contract rather than a live response shape."""

from unittest.mock import patch

import pytest

from agent.tools.meetings import live_capture as lc


@pytest.mark.parametrize("url,expected", [
    ("https://zoom.us/j/123?pwd=456", "zoom"),
    ("https://meet.google.com/abc-defg-hij", "google_meet"),
    ("https://teams.microsoft.com/l/meetup-join/xyz", "teams"),
    ("https://example.com/no-platform", None),
])
def test_guess_platform(url, expected):
    assert lc.guess_platform(url) == expected


@pytest.mark.parametrize("bot,expected", [
    ({"status": "call_ended"}, "done"),
    ({"status": "analysis_done"}, "done"),
    ({"status": "fatal_error"}, "failed"),
    ({"status": "in_call_recording"}, "pending"),
    ({"status_changes": [{"code": "joining_call"}]}, "pending"),
    ({"status_changes": [{"code": "done"}]}, "done"),
    ({}, "pending"),
])
def test_bot_phase(bot, expected):
    assert lc.bot_phase(bot) == expected


def _fake_result(payload):
    class _R:
        status = "success"
        result = payload
    return _R()


def test_fetch_transcript_spans_handles_dict_speaker_and_plain_string():
    payload = {"results": [
        {"text": "Ship on Friday.", "speaker": {"name": "Alice"}, "start_time": "0.0"},
        {"text": "Agreed.", "participant": "Bob", "start": 3.5},
    ]}
    with patch.object(lc, "_call", return_value=_fake_result(payload)):
        spans = lc.fetch_transcript_spans({"recordings": [{"id": "rec-1"}]})
    assert [s["speaker"] for s in spans] == ["Alice", "Bob"]
    assert [s["text"] for s in spans] == ["Ship on Friday.", "Agreed."]


def test_fetch_transcript_spans_raises_on_no_recording():
    with pytest.raises(RuntimeError, match="no recording"):
        lc.fetch_transcript_spans({"recordings": []})


def test_fetch_transcript_spans_raises_on_unrecognized_shape():
    with patch.object(lc, "_call", return_value=_fake_result({"unexpected": True})):
        with pytest.raises(RuntimeError, match="unrecognized"):
            lc.fetch_transcript_spans({"recordings": [{"id": "rec-1"}]})
