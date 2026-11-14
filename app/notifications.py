"""ICS calendar export and the browser-notification payload."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional
from urllib.parse import urljoin

from .db import Database
from .reminders import due_items, upcoming_items
from .timeutil import now_ms


def _utc_stamp(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _escape(value: str) -> str:
    return (
        (value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    if len(line) <= 75:
        return line
    chunks = [line[:75]]
    remaining = line[75:]
    while remaining:
        chunks.append(" " + remaining[:74])
        remaining = remaining[74:]
    return "\r\n".join(chunks)


def _event(
    *,
    uid: str,
    start_ms: int,
    summary: str,
    description: str = "",
    url: str = "",
    alarm_minutes: Optional[int] = None,
) -> list[str]:
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_utc_stamp(now_ms())}",
        f"DTSTART:{_utc_stamp(start_ms)}",
        f"DTEND:{_utc_stamp(start_ms + 30 * 60_000)}",
        f"SUMMARY:{_escape(summary)}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{_escape(description)}")
    if url:
        lines.append(f"URL:{_escape(url)}")
    if alarm_minutes is not None:
        lines.extend(
            [
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{_escape(summary)}",
                f"TRIGGER:-PT{int(alarm_minutes)}M",
                "END:VALARM",
            ]
        )
    lines.append("END:VEVENT")
    return lines


def application_events(app: dict, *, base_url: str = "") -> list[list[str]]:
    app_id = app.get("id", "")
    company = app.get("company") or "Application"
    role = app.get("role") or ""
    label = f"{company}" + (f" — {role}" if role else "")
    link = urljoin(base_url + "/", f"?application={app_id}") if base_url else ""
    events: list[list[str]] = []
    if app.get("check_back_at"):
        events.append(
            _event(
                uid=f"checkin-{app_id}@internship-dashboard",
                start_ms=int(app["check_back_at"]),
                summary=f"Check in: {label}",
                description=app.get("next_action") or "Open the tracker and update this application.",
                url=link,
                alarm_minutes=0,
            )
        )
    if app.get("next_action_at"):
        events.append(
            _event(
                uid=f"action-{app_id}@internship-dashboard",
                start_ms=int(app["next_action_at"]),
                summary=f"{app.get('next_action') or 'Action due'}: {label}",
                description=f"Stage: {app.get('stage', '')}",
                url=link,
                alarm_minutes=60,
            )
        )
    return events


def build_calendar(name: str, event_blocks: Iterable[list[str]]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Internship Dashboard//EN",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_escape(name)}",
    ]
    for block in event_blocks:
        lines.extend(block)
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def application_calendar(app: dict, *, base_url: str = "") -> str:
    company = app.get("company") or "Application"
    return build_calendar(
        f"Internship — {company}",
        application_events(app, base_url=base_url),
    )


def user_calendar(db: Database, user_id: int, *, base_url: str = "") -> str:
    blocks: list[list[str]] = []
    for app in db.list_applications(user_id, status="active", limit=1000):
        blocks.extend(application_events(app, base_url=base_url))
    return build_calendar("Internship Dashboard", blocks)


def notification_feed(db: Database, user_id: int, *, now: Optional[int] = None) -> dict:
    now = now or now_ms()
    return {
        "now": now,
        "due": due_items(db, user_id, now),
        "upcoming": upcoming_items(db, user_id, hours=48, now=now),
    }
