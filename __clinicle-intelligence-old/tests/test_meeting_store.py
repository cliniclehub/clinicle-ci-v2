"""Smoke tests for the Meeting Assistant store: ACL, the draft->review->
published lifecycle, and stalled-job recovery. Focused on the security-
relevant paths (per-resource ACL, publish is one-way) rather than exhaustive
coverage of every CRUD helper."""

import pathlib

import pytest

from agent.workspace import meeting_store as ms


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ms, "_db_path", lambda: tmp_path / "meetings.db")


def test_create_and_get_roundtrip():
    meeting = ms.create_meeting("Standup", org_id="1", organizer_user_id=42, organizer_agent_id="default")
    fetched = ms.get_meeting(meeting["id"])
    assert fetched["title"] == "Standup"
    assert fetched["status"] == "draft"


def test_acl_organizer_and_admin_see_draft_stranger_does_not():
    meeting = ms.create_meeting("1:1", org_id="1", organizer_user_id=42, organizer_agent_id="default")
    assert ms.can_view(meeting, 42, False) is True
    assert ms.can_view(meeting, 999, False) is False
    assert ms.can_view(meeting, 999, True) is True
    # No user_id at all means a legacy single-password instance -- unfiltered.
    assert ms.can_view(meeting, None, False) is True


def test_publish_requires_review_status_and_is_one_way():
    meeting = ms.create_meeting("Planning", org_id="1", organizer_user_id=1, organizer_agent_id="default")
    with pytest.raises(ValueError):
        ms.publish_meeting(meeting["id"])  # still draft

    with pytest.raises(ValueError):
        ms.update_meeting(meeting["id"], status="published")  # must go through publish_meeting

    ms.save_transcript(meeting["id"], source_type="text", text="hi", spans=[{"idx": 0, "text": "hi"}])
    ms.save_extraction_result(
        meeting["id"], summary="Discussed roadmap.",
        decisions=[], open_questions=[],
        action_items=[{"task": "Follow up", "owner_uncertain": True, "due_uncertain": True}],
        attendance=[],
    )
    assert ms.get_meeting(meeting["id"])["status"] == "review"

    published = ms.publish_meeting(meeting["id"])
    assert published["status"] == "published"


def test_published_meeting_visible_only_to_matched_participants():
    meeting = ms.create_meeting("Review", org_id="1", organizer_user_id=1, organizer_agent_id="default")
    ms.save_transcript(meeting["id"], source_type="text", text="hi", spans=[{"idx": 0, "text": "hi"}])
    ms.save_extraction_result(
        meeting["id"], summary="s", decisions=[], open_questions=[], action_items=[], attendance=[],
    )
    ms.publish_meeting(meeting["id"])
    meeting = ms.get_meeting(meeting["id"])

    # No tenancy store reachable in this test environment -> participants stay
    # unmatched (no user_id), so a random user still cannot see a published
    # meeting just because they were invited by free-text name.
    ms.add_participants(meeting["id"], [{"name": "Bob", "email": "bob@example.com"}])
    assert ms.can_view(meeting, 555, False) is False


def test_live_capture_query_helpers_are_org_scoped():
    import time

    due_soon = ms.create_meeting(
        "Standup", org_id="1", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/1", occurred_at=time.time() + 300,
    )
    ms.create_meeting(  # a different org's due meeting must never show up in org "1"'s list
        "Other org's standup", org_id="2", organizer_user_id=1, organizer_agent_id="default",
        capture_mode="live_bot", meeting_url="https://zoom.us/j/2", occurred_at=time.time() + 300,
    )

    due = ms.list_due_live_captures(1200, org_id="1")
    assert [m["id"] for m in due] == [due_soon["id"]]
    assert ms.list_due_live_captures(1200, org_id="2") != []
    assert set(ms.list_org_ids_with_live_captures()) == {"1", "2"}

    ms.set_bot_id(due_soon["id"], "bot-1", platform="zoom")
    assert ms.list_due_live_captures(1200, org_id="1") == []
    active = ms.list_meetings_with_active_bot(org_id="1")
    assert [m["id"] for m in active] == [due_soon["id"]]
    assert ms.list_meetings_with_active_bot(org_id="2") == []


def test_sweep_stalled_jobs_marks_running_as_failed():
    meeting = ms.create_meeting("Sync", org_id="1", organizer_user_id=1, organizer_agent_id="default")
    job = ms.create_job(meeting["id"], "extract")
    ms.update_job(job["id"], status="running", started_at=1.0)

    swept = ms.sweep_stalled_jobs()
    assert swept == 1

    latest = ms.latest_job_for_meeting(meeting["id"])
    assert latest["status"] == "failed"
    assert ms.get_meeting(meeting["id"])["job_error"]
