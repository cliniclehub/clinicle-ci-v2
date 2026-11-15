"""Meeting Assistant endpoints: /api/meetings/* -- manual transcript capture
(paste, .vtt/.srt upload), AI extraction into an editable draft, organizer
review/publish, and a per-meeting participant ACL. Same thin shape as
api/task_board.py: auth-guard, resolve access, call the store, shape JSON.

Raw meeting audio is deliberately NOT accepted here for v1: the only ASR path
in this codebase (api/files.py's VoiceAsrHandler -> Bridge().fetch_voice_to_text)
is built and tested for short mic clips, not hour-long recordings, and a
half-working long-audio transcript would silently corrupt the no-hallucination
guarantee the extraction pipeline otherwise enforces. Text-paste and
.vtt/.srt cover real meeting-tool exports (Zoom/Meet/Teams native formats);
shipping degraded audio support would be worse than not having it.

ACL: before a meeting is published, only its organizer and org admins can see
it -- participants are not shown an unreviewed AI draft. Once published, a
participant whose email matched a real tenancy User (see
meeting_store.add_participants) gains access too. A participant with no
matched account can appear in the record but cannot be granted access this
way; the organizer/an admin can always see it.

On a legacy single-shared-password instance (no real per-user accounts yet --
TenancyStore.has_any_user() is False), there is no per-user identity to scope
access to anywhere else in the app either, so every meeting is visible to any
authenticated caller within the org -- the same trust boundary every other
view already runs on, not a weaker one invented for this feature.
"""

from __future__ import annotations

import json

import web

from agent.tools.meetings import job_runner, live_capture, transcript_ingest
from agent.workspace import meeting_store
from channel.web.api.auth import _current_user_id
from channel.web.core._common import _raw_web_input, _require_auth, _scoped_agent_id
from common.log import logger
from common.runtime_identity import current_identity


def _not_found():
    web.ctx.status = "404 Not Found"
    return json.dumps({"status": "error", "message": "Not found"})


def _bad_request(message: str):
    web.ctx.status = "400 Bad Request"
    return json.dumps({"status": "error", "message": message})


def _org_id() -> str:
    return current_identity().org_id


def _is_org_admin(user_id, org_id) -> bool:
    """Resolved against the MEETING's own org_id, never the ambient request
    identity directly -- the two should always agree for a same-org request,
    but a lookup that trusted the caller's identity instead of the resource's
    own org would be exactly the IDOR shape this file's ACL exists to avoid."""
    if user_id is None or org_id is None:
        return False
    try:
        from agent.tenancy.store import get_tenancy_store

        return get_tenancy_store().has_role(int(user_id), int(org_id), "admin")
    except Exception as e:  # never let an admin check crash the request
        logger.debug(f"[Meetings] admin check skipped: {e}")
        return False


def _load_with_access(meeting_id: str):
    """Returns (meeting, user_id) on success, or a JSON 404 string on
    failure. A meeting that exists but the caller cannot see returns the
    SAME 404 a nonexistent one would -- never 403 -- so a probe cannot
    distinguish "not yours" from "does not exist" (see A8 in this repo's
    security standards)."""
    meeting = meeting_store.get_meeting(meeting_id)
    if meeting is None:
        return None, None, _not_found()
    user_id = _current_user_id()
    is_admin = _is_org_admin(user_id, meeting.get("org_id"))
    if not meeting_store.can_view(meeting, user_id, is_admin):
        return None, None, _not_found()
    return meeting, user_id, None


class MeetingsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        user_id = _current_user_id()
        org_id = _org_id()
        is_admin = _is_org_admin(user_id, org_id) if user_id is not None else True
        meetings = meeting_store.list_meetings(org_id, user_id, is_admin)
        return json.dumps({"status": "success", "meetings": meetings}, ensure_ascii=False)

    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            title = str(body.get("title") or "").strip()
            if not title:
                return _bad_request("title is required")
            meeting = meeting_store.create_meeting(
                title, org_id=_org_id(), organizer_user_id=_current_user_id(),
                organizer_agent_id=_scoped_agent_id(body),
                occurred_at=body.get("occurred_at"),
            )
            attendees = body.get("attendees") or []
            if attendees:
                meeting_store.add_participants(meeting["id"], attendees)
            return json.dumps({"status": "success", "meeting": meeting_store.get_meeting(meeting["id"])},
                               ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Meetings] create failed: {e}")
            return json.dumps({"status": "error", "message": "Could not create meeting"})


class MeetingHandler:
    def GET(self, meeting_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        return json.dumps({
            "status": "success",
            "meeting": meeting,
            "participants": meeting_store.list_participants(meeting_id),
            "minutes": meeting_store.list_minutes_sections(meeting_id),
            "action_items": meeting_store.list_action_items(meeting_id),
            "transcript_spans": meeting_store.get_transcript_spans(meeting_id),
            "job": meeting_store.latest_job_for_meeting(meeting_id),
            "job_status": job_runner.get_status(meeting_id),
        }, ensure_ascii=False)

    def PUT(self, meeting_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        try:
            body = json.loads(web.data() or "{}")
            fields = {}
            if "title" in body:
                fields["title"] = str(body["title"]).strip()
            if "summary" in body:
                fields["summary"] = str(body["summary"]).strip()
            updated = meeting_store.update_meeting(meeting_id, **fields) if fields else meeting
            return json.dumps({"status": "success", "meeting": updated}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))


class MeetingParticipantsHandler:
    def POST(self, meeting_id):
        """Organizer sets/replaces the attendee list, matched against real
        accounts. Only before publish -- once published the invite/ACL set
        is settled, matching update_meeting's own publish-is-one-way rule."""
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        if meeting["status"] == "published":
            return _bad_request("cannot change participants on a published meeting")
        try:
            body = json.loads(web.data() or "{}")
            attendees = body.get("attendees") or []
            participants = meeting_store.add_participants(meeting_id, attendees)
            return json.dumps({"status": "success", "participants": participants}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))


class MeetingTranscriptHandler:
    def POST(self, meeting_id):
        """Paste (JSON: {"source_type":"text","content":"..."}) or upload
        (multipart: field "file" + "source_type" of "vtt"/"srt"). Parses,
        stores, and kicks off the background extraction job."""
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        if meeting["status"] == "published":
            return _bad_request("cannot replace the transcript of a published meeting")

        content_type = web.ctx.env.get("CONTENT_TYPE", "") or ""
        try:
            if content_type.startswith("multipart/"):
                params = _raw_web_input()
                source_type = str(params.get("source_type") or "").strip().lower()
                file_obj = params.get("file")
                if file_obj is None:
                    return _bad_request("no file provided")
                if source_type not in ("vtt", "srt"):
                    filename = (getattr(file_obj, "filename", "") or "").lower()
                    source_type = "vtt" if filename.endswith(".vtt") else "srt" if filename.endswith(".srt") else ""
                if source_type not in ("vtt", "srt"):
                    return _bad_request("uploaded file must be .vtt or .srt")
                raw = file_obj.file.read() if hasattr(file_obj, "file") else file_obj.value
                content = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
            else:
                body = json.loads(web.data() or "{}")
                source_type = str(body.get("source_type") or "text").strip().lower()
                content = str(body.get("content") or "")
                if not content.strip():
                    return _bad_request("content is required")

            text, spans = transcript_ingest.ingest(source_type, content)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Meetings] transcript ingest failed for {meeting_id}: {e}")
            return _bad_request("could not parse transcript")

        meeting_store.save_transcript(meeting_id, source_type=source_type, text=text, spans=spans)
        job_runner.start_extraction_job(meeting_id)
        return json.dumps({"status": "success", "meeting": meeting_store.get_meeting(meeting_id)},
                           ensure_ascii=False)


class MeetingReprocessHandler:
    def POST(self, meeting_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        try:
            job_runner.reprocess(meeting_id)
            return json.dumps({"status": "success"}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))


class MeetingPublishHandler:
    def POST(self, meeting_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        try:
            published = meeting_store.publish_meeting(meeting_id)
            return json.dumps({"status": "success", "meeting": published}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))


class MeetingActionItemHandler:
    def PUT(self, meeting_id, item_id):
        """Organizer resolving an uncertain owner/date, editing the task
        text, or marking one done. Owner reassignment is restricted to a
        real participant (or explicitly left uncertain) -- never a free-typed
        name here, so a resolved owner is always someone the meeting
        actually lists."""
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        try:
            body = json.loads(web.data() or "{}")
            fields = {}
            if "task" in body:
                fields["task"] = str(body["task"]).strip()
            if "status" in body:
                status = str(body["status"]).strip()
                if status not in ("open", "done"):
                    return _bad_request("status must be 'open' or 'done'")
                fields["status"] = status
            if "owner_participant_id" in body:
                pid = body["owner_participant_id"]
                if pid is None:
                    fields.update(owner_user_id=None, owner_name=None, owner_uncertain=1)
                else:
                    participant = next(
                        (p for p in meeting_store.list_participants(meeting_id) if p["id"] == pid), None
                    )
                    if participant is None:
                        return _bad_request("owner_participant_id is not a participant of this meeting")
                    fields.update(
                        owner_user_id=participant.get("user_id"),
                        owner_name=participant.get("name"),
                        owner_uncertain=0,
                    )
            if "due_date" in body:
                due = body["due_date"]
                fields["due_date"] = due
                fields["due_uncertain"] = 0 if due else 1
            if not fields:
                return _bad_request("no editable fields given")
            item = meeting_store.update_action_item(meeting_id, int(item_id), **fields)
            return json.dumps({"status": "success", "action_item": item}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))


class MeetingCalendarPrefillHandler:
    """Pulls a Google Calendar event's invitee list via the same org-scoped,
    audit-logged Composio call every other connector-backed feature uses
    (agent/tools/connectors/connector_call.py) -- called directly server-side
    since this is a deterministic lookup, not a model decision. Metadata
    only: it prefills the participant list, never the transcript."""

    def POST(self, meeting_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        try:
            body = json.loads(web.data() or "{}")
            event_id = str(body.get("event_id") or "").strip()
            if not event_id:
                return _bad_request("event_id is required")

            from agent.tools.connectors.connector_call import ConnectorCallTool

            # GOOGLECALENDAR_EVENTS_GET: "fetches ONE specific event when you
            # already know its ID" (verified against Composio's Google
            # Calendar toolkit docs 2026-09-24) -- GOOGLECALENDAR_FIND_EVENT
            # used here previously was wrong: that action is a search/list
            # endpoint with time_min/time_max/query filters, not a get-by-id.
            result = ConnectorCallTool().execute({
                "tool_slug": "GOOGLECALENDAR_EVENTS_GET",
                "arguments": {"event_id": event_id},
            })
            if result.status != "success":
                return json.dumps({"status": "error", "message": str(result.result)})

            attendees_raw = (result.result or {}).get("attendees") or []
            attendees = [
                {"name": a.get("displayName") or a.get("email") or "", "email": a.get("email")}
                for a in attendees_raw if a.get("email")
            ]
            participants = meeting_store.add_participants(meeting_id, attendees)
            meeting_store.update_meeting(meeting_id, calendar_event_id=event_id)
            return json.dumps({"status": "success", "participants": participants}, ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.warning(f"[Meetings] calendar prefill failed for {meeting_id}: {e}")
            return json.dumps({"status": "error", "message": "Calendar prefill failed"})


class UpcomingMeetingsHandler:
    """Lists upcoming events from the connected calendar that could become a
    live-capture meeting, and lets the organizer opt one in. Nothing here
    ever sends a bot by itself -- POST just creates a 'live_bot' meeting
    record; agent/tools/meetings/calendar_watch.py's background service is
    what actually dispatches the bot once the meeting's start time nears."""

    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        import time as _time

        from agent.tools.meetings import calendar_sources

        now = _time.time()
        raw_events = calendar_sources.list_all_events(now, now + 30 * 86400)

        already_linked = {
            m.get("calendar_event_id") for m in meeting_store.list_meetings(_org_id(), None, True)
            if m.get("calendar_event_id")
        }
        events = []
        for event in raw_events:
            if not event.get("event_id") or event["event_id"] in already_linked:
                continue
            if not event.get("meeting_url"):
                continue  # not something a bot could join
            events.append(event)
        return json.dumps({"status": "success", "events": events}, ensure_ascii=False)

    def POST(self):
        """Body: {"event_id", "title", "starts_at", "meeting_url", "attendees"} --
        exactly one row GET (or the calendar view endpoint) returned. The
        client echoes back what it already has rather than this handler
        re-fetching by id, since the event may have come from either Google
        Calendar or Outlook and this endpoint doesn't know which."""
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            event_id = str(body.get("event_id") or "").strip()
            title = str(body.get("title") or "").strip()
            meeting_url = str(body.get("meeting_url") or "").strip()
            starts_at = body.get("starts_at")
            if not (event_id and title and meeting_url and starts_at):
                return _bad_request("event_id, title, meeting_url and starts_at are required")

            meeting = meeting_store.create_meeting(
                title, org_id=_org_id(), organizer_user_id=_current_user_id(),
                organizer_agent_id=_scoped_agent_id(body), occurred_at=float(starts_at),
                capture_mode="live_bot", meeting_url=meeting_url, calendar_event_id=event_id,
            )
            attendees = body.get("attendees") or []
            if attendees:
                meeting_store.add_participants(meeting["id"], attendees)
            return json.dumps({"status": "success", "meeting": meeting_store.get_meeting(meeting["id"])},
                               ensure_ascii=False)
        except ValueError as e:
            return _bad_request(str(e))
        except Exception as e:
            logger.error(f"[Meetings] enabling live capture failed: {e}")
            return json.dumps({"status": "error", "message": "Could not enable live capture"})


class MeetingCalendarViewHandler:
    """Backs the Meetings view's day/month/year calendar grid: every event
    from every connected calendar (Google Calendar + Outlook, best-effort --
    see agent/tools/meetings/calendar_sources.py) within [start, end], each
    tagged with whether it already has a 'live_bot' meeting record so the
    grid can show an "enabled" badge without a second round trip."""

    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        params = web.input(start="", end="")
        try:
            start = float(params.start)
            end = float(params.end)
        except (TypeError, ValueError):
            return _bad_request("start and end (unix timestamps) are required")
        if end <= start or end - start > 400 * 86400:
            return _bad_request("end must be after start, and the range must be 400 days or less")

        from agent.tools.meetings import calendar_sources

        events = calendar_sources.list_all_events(start, end)
        meeting_by_event_id = {
            m["calendar_event_id"]: m["id"] for m in meeting_store.list_meetings(_org_id(), None, True)
            if m.get("calendar_event_id")
        }
        for event in events:
            linked_id = meeting_by_event_id.get(event.get("event_id"))
            event["already_enabled"] = linked_id is not None
            event["meeting_id"] = linked_id
        return json.dumps({"status": "success", "events": events}, ensure_ascii=False)


class MeetingCancelBotHandler:
    def POST(self, meeting_id):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        meeting, _user_id, err = _load_with_access(meeting_id)
        if err:
            return err
        if not meeting.get("bot_id"):
            return _bad_request("this meeting has no active bot")
        live_capture.remove_bot(meeting["bot_id"])
        return json.dumps({"status": "success"}, ensure_ascii=False)


def _require_meetings_admin():
    """Admin gate for org-wide Recall.ai platform setup (Zoom OAuth app,
    Google login group/SSO cert) -- these are shared credentials for the
    whole org, not a per-meeting action, so they need a stronger gate than
    _load_with_access's per-resource check. Same fallback shape as
    channel/web/api/secrets.py's _require_secrets_admin: real per-user admin
    role on a multi-tenant install, the existing app-wide password gate on a
    legacy single-password one (there is no weaker "admin" concept to check
    there either)."""
    from agent.tenancy.store import get_tenancy_store
    from channel.web.api.tenancy import _current_user_and_org

    user_id, org_id = _current_user_and_org()
    if user_id is None:
        _require_auth()
        return None
    if not get_tenancy_store().has_role(user_id, org_id, "admin"):
        web.ctx.status = "403 Forbidden"
        raise web.HTTPError("403 Forbidden", {"Content-Type": "application/json; charset=utf-8"},
                             json.dumps({"status": "error", "message": "admin role required"}))
    return org_id


class RecallaiZoomAppHandler:
    """One-time org setup: registers a Zoom OAuth app the organizer already
    created in the Zoom Marketplace (this endpoint cannot create that app --
    Zoom requires it be created through their own developer console)."""

    def POST(self):
        _require_meetings_admin()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            required = ("kind", "client_id", "client_secret", "webhook_secret")
            missing = [f for f in required if not body.get(f)]
            if missing:
                return _bad_request(f"missing required field(s): {', '.join(missing)}")
            if body["kind"] not in ("user_level", "account_level"):
                return _bad_request("kind must be 'user_level' or 'account_level'")

            arguments = {k: body[k] for k in required}
            if body.get("verification_token"):
                arguments["verification_token"] = body["verification_token"]

            from agent.tools.connectors.connector_call import ConnectorCallTool

            result = ConnectorCallTool().execute({"tool_slug": "RECALLAI_CREATE_ZOOM_OAUTH_APP", "arguments": arguments})
            if result.status != "success":
                return json.dumps({"status": "error", "message": str(result.result)})
            return json.dumps({"status": "success"}, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"[Meetings] Zoom app setup failed: {e}")
            return json.dumps({"status": "error", "message": "Could not register the Zoom app"})


class RecallaiGoogleLoginHandler:
    """Two-step org setup for Google Meet capture: create a login group,
    then add a Google account (with its SSO cert/key) to it. Both steps use
    values the organizer's Google Workspace admin must generate outside this
    app -- see this file's module docstring for what Recall.ai's own docs
    require."""

    def POST(self, action):
        _require_meetings_admin()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data() or "{}")
            from agent.tools.connectors.connector_call import ConnectorCallTool

            if action == "group":
                required = ("name", "login_mode")
                missing = [f for f in required if not body.get(f)]
                if missing:
                    return _bad_request(f"missing required field(s): {', '.join(missing)}")
                if body["login_mode"] not in ("always", "only_if_required"):
                    return _bad_request("login_mode must be 'always' or 'only_if_required'")
                tool_slug, arguments = "RECALLAI_CREATE_GOOGLE_LOGIN_GROUP", {k: body[k] for k in required}
            elif action == "account":
                required = ("email", "group_id", "sso_v2_cert", "sso_v2_private_key", "sso_v2_workspace_domain")
                missing = [f for f in required if not body.get(f)]
                if missing:
                    return _bad_request(f"missing required field(s): {', '.join(missing)}")
                tool_slug, arguments = "RECALLAI_CREATE_GOOGLE_LOGIN", {k: body[k] for k in required}
                if "is_active" in body:
                    arguments["is_active"] = bool(body["is_active"])
            else:
                return _bad_request("action must be 'group' or 'account'")

            result = ConnectorCallTool().execute({"tool_slug": tool_slug, "arguments": arguments})
            if result.status != "success":
                return json.dumps({"status": "error", "message": str(result.result)})
            return json.dumps({"status": "success", "result": result.result}, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"[Meetings] Google login setup ({action}) failed: {e}")
            return json.dumps({"status": "error", "message": "Could not complete Google login setup"})
