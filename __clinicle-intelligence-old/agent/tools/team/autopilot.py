"""Autopilot: makes a Team's task board self-triage/execute/verify on its own,
instead of needing the Leader to call ``team_manage(delegate)`` by hand for
every "todo" task.

Composes primitives that already exist rather than adding a new execution
path: dispatch reuses the exact ``Bridge().get_agent_bridge().agent_reply()``
call ``team_tool.py``'s ``delegate`` action makes (just run synchronously,
since this loop already lives on its own background thread), and the
Telegram/dashboard reporting reuses the scheduler's own channel-delivery
plumbing (``agent/tools/scheduler/integration.py``) instead of opening a
second path to the same bot -- the dashboard side needs nothing extra, since
the Task Board API (``channel/web/api/task_board.py``) already reads the same
``team_store`` state this loop writes to.

One thread per team with autopilot on, started/stopped by the
``/api/board/autopilot`` toggle. A tick:
  1. triage: pick the oldest "todo" task with an owner and no unmet blocker.
  2. execute: dispatch it to the owner's own session, mark "in_progress" while
     it runs, then "review" with the reply attached as ``result``.
  3. verify: ask the same agent a short self-check turn; "DONE" moves the task
     to "done", anything else leaves it in "review" with ``verify_note`` for a
     human to look at -- Autopilot never marks its own work done unchecked.
  4. notify: best-effort Telegram post of what happened.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, Optional

from agent.workspace import team_store
from common.log import logger

_TICK_SECONDS = 20

_threads: Dict[str, threading.Thread] = {}
_stop_events: Dict[str, threading.Event] = {}
_guard = threading.RLock()  # reentrant: start() calls is_running() while already holding this

# Coarse live-activity status for the Task Board's "Autopilot · live activity"
# panel -- set/cleared around the two real phases a tick goes through
# (dispatch, verify) so the frontend shows what is actually happening rather
# than fabricated step text. No token-level streaming: _run_turn is a single
# blocking agent_reply() call with no on_event hook, so between "dispatch
# started" and "dispatch finished" there is nothing finer-grained to report.
_status: Dict[str, dict] = {}


def is_running(team_id: str) -> bool:
    with _guard:
        thread = _threads.get(team_id)
        return bool(thread and thread.is_alive())


def get_status(team_id: str) -> Optional[dict]:
    """Current tick's phase for `team_id`, or None if autopilot is idle."""
    with _guard:
        status = _status.get(team_id)
        return dict(status) if status else None


def _set_status(team_id: str, **fields) -> None:
    with _guard:
        _status[team_id] = fields


def _clear_status(team_id: str) -> None:
    with _guard:
        _status.pop(team_id, None)


def start(team_id: str) -> None:
    with _guard:
        if is_running(team_id):
            return
        stop_event = threading.Event()
        _stop_events[team_id] = stop_event
        thread = threading.Thread(
            target=_loop, args=(team_id, stop_event), daemon=True,
            name=f"autopilot-{team_id}",
        )
        _threads[team_id] = thread
        thread.start()


def stop(team_id: str) -> None:
    with _guard:
        stop_event = _stop_events.get(team_id)
    if stop_event:
        stop_event.set()


def _loop(team_id: str, stop_event: threading.Event) -> None:
    logger.info(f"[Autopilot] started for team {team_id}")
    while not stop_event.is_set() and team_store.is_autopilot_enabled(team_id):
        try:
            _tick(team_id)
        except Exception as e:
            logger.error(f"[Autopilot] tick failed for team {team_id}: {e}")
        stop_event.wait(_TICK_SECONDS)
    _clear_status(team_id)
    logger.info(f"[Autopilot] stopped for team {team_id}")


def _next_dispatchable_task(team: dict) -> Optional[dict]:
    tasks = team.get("tasks", [])
    done_ids = {t["id"] for t in tasks if t.get("status") == "done"}
    for task in tasks:
        if task.get("status") != "todo" or not task.get("owner"):
            continue
        if all(bid in done_ids for bid in task.get("blocked_by") or []):
            return task
    return None


def _tick(team_id: str) -> None:
    team = team_store.get_team(team_id)
    if not team:
        return
    task = _next_dispatchable_task(team)
    if not task:
        return

    target = next((m for m in team["members"] if m["slot_id"] == task["owner"]), None)
    if not target:
        return

    team_store.update_task(team_id, task["id"], status="in_progress")
    team_store.mark_slot_running(team_id, target["slot_id"])
    _set_status(
        team_id, task_id=task["id"], subject=task["subject"], phase="dispatch",
        agent_id=target["agent_id"], team_name=team["name"],
    )
    try:
        result = _run_turn(target["agent_id"], target["session_id"], task["subject"])
    except Exception as e:
        team_store.update_task(team_id, task["id"], status="review", verify_note=f"Execution failed: {e}")
        team_store.mark_slot_idle(team_id, target["slot_id"])
        _clear_status(team_id)
        _record_task_failure(task, target["agent_id"], str(e))
        _notify(f'[Autopilot] {team["name"]}: "{task["subject"]}" failed to run -- {e}')
        return
    team_store.mark_slot_idle(team_id, target["slot_id"])
    team_store.update_task(team_id, task["id"], status="review", result=result)

    _set_status(
        team_id, task_id=task["id"], subject=task["subject"], phase="verify",
        agent_id=target["agent_id"], team_name=team["name"],
    )
    verified, note = _verify(target["agent_id"], target["session_id"], task["subject"])
    _clear_status(team_id)
    if verified:
        team_store.update_task(team_id, task["id"], status="done", verify_note=note)
        _notify(f'[Autopilot] {team["name"]}: "{task["subject"]}" done by {target["agent_id"]}.')
    else:
        team_store.update_task(team_id, task["id"], verify_note=note)
        _notify(
            f'[Autopilot] {team["name"]}: "{task["subject"]}" needs a look -- '
            f'{target["agent_id"]} flagged: {note}'
        )


def _run_turn(agent_id: str, session_id: str, text: str) -> str:
    """One blocking turn against a slot's own session -- same call
    team_tool.py's delegate action makes, just synchronous here."""
    from bridge.bridge import Bridge
    from bridge.context import Context, ContextType

    context = Context(ContextType.TEXT, text)
    context["session_id"] = session_id
    context["agent_id"] = agent_id
    context["is_scheduled_task"] = True
    reply = Bridge().get_agent_bridge().agent_reply(text, context=context, on_event=None, clear_history=False)
    return (reply.content if reply else "") or "(no content)"


def _verify(agent_id: str, session_id: str, subject: str) -> tuple:
    """Ask the agent to self-check its own last turn. Returns (verified, note).
    Lazy grading -- a leading "DONE" passes, anything else (including a failed
    verify call) stays in "review" for a human, never auto-approved on doubt."""
    prompt = (
        f'Self-check: did you fully complete "{subject}"? '
        'Reply with "DONE" if yes, or "ISSUES: <what is missing>" if not.'
    )
    try:
        note = _run_turn(agent_id, session_id, prompt)
    except Exception as e:
        return False, f"verify call failed: {e}"
    return note.strip().upper().startswith("DONE"), note


def _record_task_failure(task: dict, agent_id: str, error: str) -> None:
    """Audit-log a dispatch failure so Alerts has a real signal to show --
    see channel/web/api/alerts.py's "task_failed" rule. Best-effort: a
    logging failure must never take down the tick that is already handling
    a real failure."""
    try:
        from agent.audit.log import record_event
        from common.runtime_identity import current_identity

        record_event(
            current_identity().org_id, agent_id, "task_failed",
            {"task_id": task["id"], "subject": task["subject"], "error": error},
        )
    except Exception as e:
        logger.warning(f"[Autopilot] audit record skipped: {e}")


def _notify(text: str) -> None:
    """Best-effort Telegram post via the scheduler's own delivery resolver --
    see agent/tools/scheduler/integration.py. Silently does nothing if no
    Telegram recipient has ever messaged this instance, since Autopilot must
    never block or fail a task over an optional notification."""
    try:
        from agent.tools.scheduler.integration import _resolve_delivery_channel, get_recipient_store
        from bridge.context import Context, ContextType
        from bridge.reply import Reply, ReplyType

        target = next(
            (r for r in get_recipient_store().list() if r.get("channel_type") == "telegram"), None
        )
        if not target:
            return
        receiver = target.get("receiver")
        channel = _resolve_delivery_channel("telegram", target.get("instance_id") or "", receiver)
        if not channel:
            return
        context = Context(ContextType.TEXT, text)
        context["receiver"] = receiver
        context["isgroup"] = target.get("is_group", False)
        context["session_id"] = receiver
        channel.send(Reply(ReplyType.TEXT, text), context)
    except Exception as e:
        logger.warning(f"[Autopilot] telegram notify failed: {e}")


def sync_running_teams() -> None:
    """Start a loop for every team already marked autopilot-enabled on disk --
    call once at process startup so a restart doesn't silently drop it."""
    for team in team_store.list_teams():
        if team.get("autopilot"):
            start(team["id"])
