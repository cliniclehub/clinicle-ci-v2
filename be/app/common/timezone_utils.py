"""IANA timezone validation and org-local calendar window → UTC instants."""

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def validate_iana_timezone(tz_name: str) -> str:
    if not tz_name or not str(tz_name).strip():
        raise ValueError("Timezone cannot be empty")
    name = str(tz_name).strip()
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as e:
        raise ValueError(f"Invalid IANA timezone: {name}") from e
    return name


def inclusive_date_window_to_utc(
    start: date,
    end: date,
    tz_name: str,
) -> tuple[datetime, datetime]:
    """
    Interpret inclusive calendar [start, end] in tz_name.
    Opens at start 00:00:00 and closes at end 23:59:59.999999 in that zone; return UTC aware datetimes.
    """
    tz = ZoneInfo(validate_iana_timezone(tz_name))
    open_local = datetime.combine(start, time.min, tzinfo=tz)
    close_local = datetime.combine(end, time(23, 59, 59, 999999), tzinfo=tz)
    return (
        open_local.astimezone(timezone.utc),
        close_local.astimezone(timezone.utc),
    )


def format_utc_instant_for_org(
    dt: datetime | None,
    tz_name: str = "UTC",
    *,
    include_time: bool = False,
) -> str:
    """Human-readable datetime in the organization timezone (for emails and user messages)."""
    if dt is None:
        return ""
    tz = ZoneInfo(validate_iana_timezone(tz_name))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(tz)
    if include_time:
        time_part = local.strftime("%I:%M %p").lstrip("0")
        tz_label = local.strftime("%Z") or tz_name
        return f"{local.strftime('%B %d, %Y')} at {time_part} ({tz_label})"
    return local.strftime("%B %d, %Y")


def _format_local_time_label(local: datetime) -> str:
    return local.strftime("%I:%M %p").lstrip("0")


def format_session_window_for_org(
    start: datetime | None,
    end: datetime | None,
    tz_name: str = "UTC",
) -> str:
    """Human-readable event date and time range in the organization timezone."""
    if start is None:
        return ""
    tz = ZoneInfo(validate_iana_timezone(tz_name))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    start_local = start.astimezone(tz)
    date_label = f"{start_local.strftime('%A, %B')} {start_local.day}, {start_local.year}"
    tz_label = start_local.strftime("%Z") or tz_name

    if end is None:
        return f"{date_label} at {_format_local_time_label(start_local)} ({tz_label})"

    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    end_local = end.astimezone(tz)
    return (
        f"{date_label} · "
        f"{_format_local_time_label(start_local)} – {_format_local_time_label(end_local)} "
        f"{tz_label}"
    )


def utc_instant_to_org_calendar_date(dt: datetime | None, tz_name: str) -> date | None:
    """Map a stored UTC instant to the calendar date in the organization timezone."""
    if dt is None:
        return None
    tz = ZoneInfo(validate_iana_timezone(tz_name))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date()
