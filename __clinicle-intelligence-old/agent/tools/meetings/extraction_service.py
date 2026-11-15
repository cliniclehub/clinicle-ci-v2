"""Transcript -> structured meeting record, via one forced tool-call turn.

Structured AI output in this codebase runs through tool-calling
(agent/protocol/agent_stream.py's build_tools_schema()), not a provider
``response_format=json_schema`` mode -- so extraction is modeled as a single
tool, ``record_meeting_minutes``, that the model must call with the full
structured result. The isolated-agent pattern (restricted tool list, a
throwaway Agent instance, extra_system_suffix, run_stream(clear_history=True))
mirrors agent/evolution/executor.py's review agent exactly -- the existing
precedent for "run one headless model pass with a task-specific prompt and a
narrow toolset".

Anti-hallucination is enforced twice, not once: the system prompt instructs
the model (mirroring agent/evolution/prompts.py's "default to nothing" style)
to mark an owner/date uncertain rather than invent it, AND every owner/
attendance claim the model returns is independently re-resolved against the
meeting's own participant list in Python (_resolve_owner/_resolve_attendance)
-- a model that names someone who isn't an actual participant never produces
a linked owner, no matter how confidently it answered.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from agent.tools.base_tool import BaseTool, ToolResult
from common.log import logger

EXTRACTION_SYSTEM_PROMPT = """You are a meeting-minutes extraction assistant.

You are given a meeting transcript as a numbered list of spans (paragraphs or
timed cues) and the list of people who were invited. Your ONLY job is to call
the `record_meeting_minutes` tool exactly once with a structured extraction.
Do not reply with plain text; do not ask questions; do not add commentary.

# Top principle: never invent an owner, a date, or a claim

If the transcript does not explicitly support something, leave it out or mark
it uncertain -- do not guess, infer from "someone probably meant it", or fill
a gap to make the record look complete. A short, honest record beats a
complete-looking fabricated one.

- An action item's owner is only set (and `owner_uncertain: false`) when the
  transcript names a specific person as responsible for that specific task.
  "The team will handle it", a vague "someone should", or no assignment
  mentioned at all -> `owner_name: null, owner_uncertain: true`.
- A due date is only set (and `due_uncertain: false`) when a specific date or
  day was explicitly agreed in the transcript ("by Friday", "March 3rd").
  "Soon", "later", "when we can" -> `due_date: null, due_uncertain: true`.
- Attendance: mark someone as attended ONLY if the transcript shows them
  speaking or being directly addressed and responding. Being on the invite
  list is NOT evidence of attendance -- do not include anyone in `attendance`
  on that basis alone.
- Every decision, open question, and action item must cite the `span_idx` of
  the transcript span that supports it. If nothing in the transcript supports
  an item, do not include the item.
- `summary` is a concise, factual paragraph of what was actually discussed --
  no speculation about intent, no filler.

Reply in the transcript's own language when it is consistently one language
other than English; otherwise English.
"""


def _spans_as_prompt(spans: List[Dict[str, Any]]) -> str:
    lines = []
    for span in spans:
        prefix = f"[{span['idx']}]"
        if span.get("start_ts"):
            prefix += f" ({span['start_ts']})"
        if span.get("speaker"):
            prefix += f" {span['speaker']}:"
        lines.append(f"{prefix} {span['text']}")
    return "\n".join(lines)


def _participants_as_prompt(participants: List[Dict[str, Any]]) -> str:
    if not participants:
        return "(no invitee list was provided)"
    return "\n".join(f"- {p['name'] or p.get('email') or '(unnamed)'}" for p in participants)


ACTION_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "task": {"type": "string"},
        "owner_name": {"type": ["string", "null"]},
        "owner_uncertain": {"type": "boolean"},
        "due_date": {"type": ["string", "null"], "description": "ISO 8601 date, e.g. 2026-09-30"},
        "due_uncertain": {"type": "boolean"},
        "span_idx": {"type": ["integer", "null"]},
    },
    "required": ["task", "owner_uncertain", "due_uncertain"],
}

_ITEM_WITH_SPAN_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "span_idx": {"type": ["integer", "null"]},
    },
    "required": ["text"],
}


class RecordMeetingMinutesTool(BaseTool):
    """Sink tool for one extraction turn -- captures the model's structured
    call onto ``self.captured`` rather than performing a side effect, so the
    caller (extract()) reads it back after run_stream() returns. A fresh
    instance is created per job; never shared or registered globally, so it
    never appears in any other agent's normal tool list."""

    name = "record_meeting_minutes"
    description = (
        "Record the structured extraction of a meeting transcript: summary, "
        "decisions, open questions, and action items. Call this exactly once "
        "with your complete extraction."
    )
    params = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "decisions": {"type": "array", "items": _ITEM_WITH_SPAN_SCHEMA},
            "open_questions": {"type": "array", "items": _ITEM_WITH_SPAN_SCHEMA},
            "action_items": {"type": "array", "items": ACTION_ITEM_SCHEMA},
            "attendance": {
                "type": "array",
                "description": "Names/emails from the invitee list the transcript supports as present.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name_or_email": {"type": "string"},
                        "span_idx": {"type": ["integer", "null"]},
                    },
                    "required": ["name_or_email"],
                },
            },
        },
        "required": ["summary", "decisions", "open_questions", "action_items", "attendance"],
    }

    def __init__(self):
        self.captured: Optional[dict] = None

    def execute(self, params: dict) -> ToolResult:
        self.captured = params
        return ToolResult.success("Recorded.")


def _resolve_owner(owner_name: Optional[str], uncertain: bool,
                    participants: List[Dict[str, Any]]) -> Dict[str, Any]:
    if uncertain or not owner_name:
        return {"owner_user_id": None, "owner_name": owner_name, "owner_uncertain": True}
    name_l = owner_name.strip().lower()
    for p in participants:
        if (p.get("name") or "").strip().lower() == name_l or (p.get("email") or "").lower() == name_l:
            # Even a named, matched owner only gets a real user_id if that
            # participant is a real, org-verified account -- see
            # meeting_store.add_participants' org-membership check. Free-text
            # attendees still get a real owner_name, just no linked account.
            return {"owner_user_id": p.get("user_id"), "owner_name": p.get("name") or owner_name, "owner_uncertain": False}
    # Named someone who isn't an actual participant -- do not silently
    # promote this to a confident owner just because the model was confident.
    return {"owner_user_id": None, "owner_name": owner_name, "owner_uncertain": True}


def _resolve_attendance(attendance: List[Dict[str, Any]],
                         participants: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    resolved = []
    for entry in attendance:
        key = str(entry.get("name_or_email") or "").strip().lower()
        if not key:
            continue
        for p in participants:
            if (p.get("name") or "").strip().lower() == key or (p.get("email") or "").lower() == key:
                resolved.append({"participant_id": p["id"], "evidence_span_idx": entry.get("span_idx")})
                break
    return resolved


def extract(meeting: Dict[str, Any], spans: List[Dict[str, Any]],
            participants: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Runs the isolated extraction turn and returns a dict shaped exactly
    for ``agent.workspace.meeting_store.save_extraction_result(**result)``.
    Raises on any failure to produce a valid structured extraction -- the
    caller (job_runner) treats that as a failed job, never a silently empty
    one, since an empty-but-"succeeded" result would look identical to a
    transcript that genuinely had nothing in it."""
    from bridge.bridge import Bridge

    agent_bridge = Bridge().get_agent_bridge()
    tool = RecordMeetingMinutesTool()

    agent = agent_bridge.create_agent(
        system_prompt="",
        tools=[tool],
        description="Meeting minutes extraction",
        max_steps=3,
        workspace_dir=None,
        enable_skills=False,
    )
    agent.extra_system_suffix = EXTRACTION_SYSTEM_PROMPT

    user_message = (
        f"Invited participants:\n{_participants_as_prompt(participants)}\n\n"
        f"Transcript:\n{_spans_as_prompt(spans)}"
    )

    try:
        agent.run_stream(user_message, clear_history=True)
    except Exception as e:
        raise RuntimeError(f"extraction turn failed: {e}") from e

    if tool.captured is None:
        raise RuntimeError("model did not call record_meeting_minutes -- no structured extraction produced")

    captured = tool.captured
    try:
        action_items = []
        for item in captured.get("action_items") or []:
            owner = _resolve_owner(item.get("owner_name"), bool(item.get("owner_uncertain")), participants)
            action_items.append({
                "task": str(item["task"]).strip(),
                "owner_user_id": owner["owner_user_id"],
                "owner_name": owner["owner_name"],
                "owner_uncertain": owner["owner_uncertain"],
                "due_date": item.get("due_date") if not item.get("due_uncertain") else None,
                "due_uncertain": bool(item.get("due_uncertain")),
                "span_idx": item.get("span_idx"),
            })

        return {
            "summary": str(captured.get("summary") or "").strip(),
            "decisions": [
                {"text": str(d["text"]).strip(), "span_idx": d.get("span_idx")}
                for d in captured.get("decisions") or [] if str(d.get("text") or "").strip()
            ],
            "open_questions": [
                {"text": str(q["text"]).strip(), "span_idx": q.get("span_idx")}
                for q in captured.get("open_questions") or [] if str(q.get("text") or "").strip()
            ],
            "action_items": action_items,
            "attendance": _resolve_attendance(captured.get("attendance") or [], participants),
        }
    except (KeyError, TypeError, ValueError) as e:
        logger.warning(f"[MeetingExtraction] malformed tool call for meeting {meeting['id']}: {e}; "
                        f"raw={json.dumps(captured, default=str)[:500]}")
        raise RuntimeError(f"model's extraction was malformed: {e}") from e
