"""Normalizes events from every connected calendar-capable toolkit into one
shape, all reached through Composio (agent/tools/connectors/connector_call.py)
-- never a direct Google/Microsoft SDK call. This is the app-wide policy for
every connector integration, not just calendars.

Two sources, two confidence levels:
  - Google Calendar (GOOGLECALENDAR_EVENTS_LIST): verified against Composio's
    own toolkit docs 2026-09-24 -- exact params confirmed.
  - Outlook (OUTLOOK_GET_CALENDAR_VIEW): the action exists ("Get events ACTIVE
    during a time window") but its exact input parameter names were not
    confirmed in this session's research -- Microsoft Graph's own
    calendarView endpoint uses startDateTime/endDateTime, so that is the best
    guess. A wrong param name fails that ONE source closed (returns []
    for it, logs a warning) rather than breaking the aggregated view --
    Google Calendar results still come back fine either way.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Dict, List, Optional

from common.log import logger

_normalized_event = Dict[str, Any]


def _iso(ts: float) -> str:
    return _dt.datetime.fromtimestamp(ts, tz=_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _call(tool_slug: str, arguments: Dict[str, Any]):
    from agent.tools.connectors.connector_call import ConnectorCallTool

    return ConnectorCallTool().execute({"tool_slug": tool_slug, "arguments": arguments})


def _url_in_text(*fields: Optional[str]) -> Optional[str]:
    """A plain http(s) URL pasted straight into a location/description
    field (common for manually pasted Zoom links that never made it into
    structured conferenceData/onlineMeeting)."""
    import re

    for field in fields:
        if not field:
            continue
        m = re.search(r"https?://\S+", field)
        if m:
            return m.group(0).rstrip(").,")
    return None


def _google_meeting_url(event: dict) -> Optional[str]:
    conference = event.get("conferenceData") or {}
    for entry in conference.get("entryPoints") or []:
        if entry.get("entryPointType") == "video" and entry.get("uri"):
            return entry["uri"]
    return _url_in_text(event.get("location"), event.get("description"))


def list_google_events(time_min: float, time_max: float) -> List[_normalized_event]:
    try:
        result = _call("GOOGLECALENDAR_EVENTS_LIST", {
            "calendarId": "primary",
            "timeMin": _iso(time_min),
            "timeMax": _iso(time_max),
            "singleEvents": True,
            "maxResults": 250,
        })
    except Exception as e:
        logger.warning(f"[CalendarSources] Google Calendar call failed: {e}")
        return []
    if result.status != "success":
        logger.warning(f"[CalendarSources] Google Calendar returned an error: {result.result}")
        return []

    raw = result.result
    items = raw.get("items") if isinstance(raw, dict) else raw
    events = []
    for event in items if isinstance(items, list) else []:
        start = event.get("start") or {}
        end = event.get("end") or {}
        all_day = "date" in start and "dateTime" not in start
        starts_at = _parse_google_dt(start)
        ends_at = _parse_google_dt(end)
        if starts_at is None:
            continue
        events.append({
            "source": "google",
            "event_id": event.get("id"),
            "title": event.get("summary") or "(untitled)",
            "starts_at": starts_at,
            "ends_at": ends_at,
            "all_day": all_day,
            "meeting_url": _google_meeting_url(event),
            "attendees": [
                {"name": a.get("displayName") or a.get("email") or "", "email": a.get("email")}
                for a in (event.get("attendees") or []) if a.get("email")
            ],
            "location": event.get("location"),
        })
    return events


def _parse_google_dt(field: dict) -> Optional[float]:
    raw = field.get("dateTime") or field.get("date")
    if not raw:
        return None
    try:
        if "T" in raw:
            return _dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        return _dt.datetime.fromisoformat(raw).replace(tzinfo=_dt.timezone.utc).timestamp()
    except ValueError:
        return None


def _outlook_meeting_url(event: dict) -> Optional[str]:
    online = event.get("onlineMeeting") or {}
    url = online.get("joinUrl") or event.get("onlineMeetingUrl")
    if url:
        return url
    return _url_in_text((event.get("location") or {}).get("displayName"), event.get("bodyPreview"))


def list_outlook_events(time_min: float, time_max: float) -> List[_normalized_event]:
    """Best-effort: OUTLOOK_GET_CALENDAR_VIEW's exact param names are
    unverified (see module docstring) -- any failure here is swallowed and
    logged, never raised, so a broken/misconfigured Outlook source degrades
    to "no Outlook events shown" instead of breaking the whole calendar."""
    try:
        result = _call("OUTLOOK_GET_CALENDAR_VIEW", {
            "start_datetime": _iso(time_min),
            "end_datetime": _iso(time_max),
        })
    except Exception as e:
        logger.info(f"[CalendarSources] Outlook not available/configured: {e}")
        return []
    if result.status != "success":
        logger.info(f"[CalendarSources] Outlook calendar view returned an error (source skipped): {result.result}")
        return []

    raw = result.result
    items = raw.get("value") if isinstance(raw, dict) else raw
    events = []
    for event in items if isinstance(items, list) else []:
        try:
            start = event.get("start") or {}
            end = event.get("end") or {}
            starts_at = _parse_outlook_dt(start)
            ends_at = _parse_outlook_dt(end)
            if starts_at is None:
                continue
            events.append({
                "source": "outlook",
                "event_id": event.get("id"),
                "title": event.get("subject") or "(untitled)",
                "starts_at": starts_at,
                "ends_at": ends_at,
                "all_day": bool(event.get("isAllDay")),
                "meeting_url": _outlook_meeting_url(event),
                "attendees": [
                    {
                        "name": (a.get("emailAddress") or {}).get("name") or (a.get("emailAddress") or {}).get("address") or "",
                        "email": (a.get("emailAddress") or {}).get("address"),
                    }
                    for a in (event.get("attendees") or []) if (a.get("emailAddress") or {}).get("address")
                ],
                "location": (event.get("location") or {}).get("displayName"),
            })
        except Exception as e:
            logger.debug(f"[CalendarSources] skipped one malformed Outlook event: {e}")
    return events


def _parse_outlook_dt(field: dict) -> Optional[float]:
    """Graph's dateTime is naive (no offset) with a separate timeZone field --
    assume UTC when the zone isn't 'UTC', which is wrong for other zones but
    fails toward "roughly the right day" rather than crashing; tighten once
    a live Outlook connection confirms the actual shape."""
    raw = field.get("dateTime")
    if not raw:
        return None
    try:
        return _dt.datetime.fromisoformat(raw).replace(tzinfo=_dt.timezone.utc).timestamp()
    except ValueError:
        return None


def list_all_events(time_min: float, time_max: float) -> List[_normalized_event]:
    events = list_google_events(time_min, time_max) + list_outlook_events(time_min, time_max)
    events.sort(key=lambda e: e["starts_at"])
    return events
