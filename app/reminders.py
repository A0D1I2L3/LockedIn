"""Reminder scheduling and the "what needs attention" feed."""

from __future__ import annotations

from typing import Optional

from .db import Database
from .models import (
    ACTION_REQUIRED,
    REMINDER_CHECK_BACK,
    REMINDER_DEADLINE,
    REMINDER_FOLLOW_UP,
    REMINDER_INTERVIEW,
    STAGE_ASSESSMENT,
    STAGE_INTERVIEW,
    STAGE_OFFER,
    STAGE_REJECTED,
    STAGE_WITHDRAWN,
    STATUS_ACTIVE,
)
from .parser.dates import reminder_offsets
from .timeutil import MS_PER_DAY, now_ms

_TERMINAL = {STAGE_REJECTED, STAGE_WITHDRAWN}


def _title(app: dict, label: str) -> str:
    company = app.get("company") or "Application"
    role = app.get("role") or ""
    return f"{label}: {company}" + (f" — {role}" if role else "")


def sync_application_reminders(db: Database, user_id: int, app: dict) -> list[dict]:
    """Replace pending reminders for one application with a fresh set.

    Safe to call after create, update, snooze, or outcome changes.
    """
    app_id = app["id"]
    db.cancel_reminders(user_id, app_id)
    if app.get("status") != STATUS_ACTIVE or app.get("stage") in _TERMINAL:
        return []

    now = now_ms()
    created: list[dict] = []

    check_back_at = app.get("check_back_at")
    if check_back_at:
        created.append(
            db.add_reminder(
                user_id,
                app_id,
                {
                    "kind": REMINDER_CHECK_BACK,
                    "due_at": int(check_back_at),
                    "title": _title(app, "Check in"),
                    "body": "Time to check back. Update the stage or snooze if you are still waiting.",
                    "payload": {"offset": "main", "stage": app.get("stage", "")},
                },
            )
        )

    next_action_at = app.get("next_action_at")
    stage = app.get("stage")
    if next_action_at:
        if stage == STAGE_ASSESSMENT:
            kind, label = REMINDER_DEADLINE, "Assessment due"
        elif stage == STAGE_INTERVIEW:
            kind, label = REMINDER_INTERVIEW, "Interview"
        elif stage == STAGE_OFFER:
            kind, label = REMINDER_FOLLOW_UP, "Respond to offer"
        else:
            kind, label = REMINDER_DEADLINE, "Action due"
        created.append(
            db.add_reminder(
                user_id,
                app_id,
                {
                    "kind": kind,
                    "due_at": int(next_action_at),
                    "title": _title(app, label),
                    "body": app.get("next_action") or "Open the application for details.",
                    "payload": {"offset": "main", "stage": stage or ""},
                },
            )
        )
        for offset_label, due_at in reminder_offsets(int(next_action_at)):
            if due_at <= now or due_at >= int(next_action_at):
                continue
            created.append(
                db.add_reminder(
                    user_id,
                    app_id,
                    {
                        "kind": kind,
                        "due_at": int(due_at),
                        "title": _title(app, f"{label} ({offset_label})"),
                        "body": app.get("next_action") or "",
                        "payload": {"offset": offset_label.split(" ")[0], "stage": stage or ""},
                    },
                )
            )

    db.add_event(
        user_id,
        app_id,
        "reminders_synced",
        {"count": len(created), "check_back_at": check_back_at, "next_action_at": next_action_at},
    )
    return created


def due_items(db: Database, user_id: int, now: Optional[int] = None) -> list[dict]:
    """Everything that needs attention now, de-duplicated and app-aware."""
    now = now or now_ms()
    applications = {
        app["id"]: app
        for app in db.list_applications(user_id, status=STATUS_ACTIVE, limit=1000)
    }
    items: list[dict] = []
    covered: set[tuple[str, str]] = set()

    for app in applications.values():
        check_back_at = app.get("check_back_at")
        next_action_at = app.get("next_action_at")
        if check_back_at and check_back_at <= now:
            covered.add((app["id"], REMINDER_CHECK_BACK))
            items.append(
                {
                    "kind": REMINDER_CHECK_BACK,
                    "application_id": app["id"],
                    "company": app.get("company", ""),
                    "role": app.get("role", ""),
                    "stage": app.get("stage", ""),
                    "due_at": check_back_at,
                    "title": _title(app, "Check in"),
                    "body": app.get("next_action") or "Time to check back.",
                    "reminder_id": None,
                }
            )
        if next_action_at and next_action_at <= now:
            covered.add((app["id"], REMINDER_DEADLINE))
            covered.add((app["id"], REMINDER_INTERVIEW))
            covered.add((app["id"], REMINDER_FOLLOW_UP))
            items.append(
                {
                    "kind": "action",
                    "application_id": app["id"],
                    "company": app.get("company", ""),
                    "role": app.get("role", ""),
                    "stage": app.get("stage", ""),
                    "due_at": next_action_at,
                    "title": _title(app, app.get("next_action") or "Action due"),
                    "body": app.get("next_action") or "",
                    "reminder_id": None,
                }
            )

    for reminder in db.list_reminders(user_id, pending_only=True, due_before=now, limit=1000):
        app = applications.get(reminder["application_id"])
        if not app:
            continue
        offset = (reminder.get("payload") or {}).get("offset")
        if offset == "main" and (reminder["application_id"], reminder["kind"]) in covered:
            continue
        items.append(
            {
                "kind": reminder["kind"],
                "application_id": reminder["application_id"],
                "company": app.get("company", ""),
                "role": app.get("role", ""),
                "stage": app.get("stage", ""),
                "due_at": reminder["due_at"],
                "title": reminder["title"],
                "body": reminder.get("body", ""),
                "reminder_id": reminder["id"],
            }
        )

    items.sort(key=lambda item: item["due_at"])
    return items


def upcoming_items(
    db: Database, user_id: int, *, hours: int = 72, now: Optional[int] = None
) -> list[dict]:
    """Upcoming check-backs and actions within the next N hours."""
    now = now or now_ms()
    horizon = now + hours * 3_600_000
    items: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for app in db.list_applications(user_id, status=STATUS_ACTIVE, limit=1000):
        for field, kind, label in (
            ("check_back_at", REMINDER_CHECK_BACK, "Check in"),
            ("next_action_at", "action", "Action"),
        ):
            due_at = app.get(field)
            if due_at and (app["id"], int(due_at)) in seen:
                continue
            if due_at and now < due_at <= horizon:
                seen.add((app["id"], int(due_at)))
                items.append(
                    {
                        "kind": kind,
                        "application_id": app["id"],
                        "company": app.get("company", ""),
                        "role": app.get("role", ""),
                        "stage": app.get("stage", ""),
                        "due_at": due_at,
                        "title": _title(app, label),
                        "body": app.get("next_action") or "",
                        "reminder_id": None,
                    }
                )
    items.sort(key=lambda item: item["due_at"])
    return items


def snooze(db: Database, user_id: int, app: dict, days: int = 3) -> dict:
    """Push the application's check-back (and action) out by N days."""
    days = max(1, min(int(days), 90))
    now = now_ms()
    base = max(app.get("check_back_at") or now, now)
    check_back_at = base + days * MS_PER_DAY
    fields = {"check_back_at": check_back_at, "check_back_source": "snoozed"}
    if app.get("next_action_at"):
        fields["next_action_at"] = max(app["next_action_at"], now) + days * MS_PER_DAY
    updated = db.update_application(user_id, app["id"], fields)
    if updated:
        db.add_event(user_id, app["id"], "snoozed", {"days": days, "check_back_at": check_back_at})
        sync_application_reminders(db, user_id, updated)
    return updated or app


def mark_action_done(db: Database, user_id: int, app: dict) -> dict:
    """Clear the current action but keep the application alive."""
    updated = db.update_application(
        user_id,
        app["id"],
        {"action_state": ACTION_REQUIRED, "next_action_at": None, "next_action": ""},
    )
    if updated:
        sync_application_reminders(db, user_id, updated)
    return updated or app
