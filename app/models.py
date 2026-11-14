"""Domain constants and lightweight row serializers.

The app tracks applications, not email threads. A single application can have
many pasted emails, reminders, and timeline events.
"""

from __future__ import annotations

import json
from typing import Any, Optional

# --------------------------------------------------------------------- stages

STAGE_APPLIED = "applied"
STAGE_ASSESSMENT = "assessment"
STAGE_INTERVIEW = "interview"
STAGE_OFFER = "offer"
STAGE_REJECTED = "rejected"
STAGE_WITHDRAWN = "withdrawn"

STAGES = [
    STAGE_APPLIED,
    STAGE_ASSESSMENT,
    STAGE_INTERVIEW,
    STAGE_OFFER,
    STAGE_REJECTED,
    STAGE_WITHDRAWN,
]

STAGE_LABELS = {
    STAGE_APPLIED: "Applied",
    STAGE_ASSESSMENT: "Assessment",
    STAGE_INTERVIEW: "Interviewing",
    STAGE_OFFER: "Offer",
    STAGE_REJECTED: "Rejected",
    STAGE_WITHDRAWN: "Withdrawn",
}

TERMINAL_STAGES = {STAGE_REJECTED, STAGE_WITHDRAWN}

# --------------------------------------------------------------------- status

STATUS_ACTIVE = "active"
STATUS_CLOSED = "closed"

ACTION_WAITING = "waiting"
ACTION_REQUIRED = "action_required"
ACTION_FOLLOW_UP = "follow_up_due"
ACTION_DONE = "done"

ACTIONS = [ACTION_WAITING, ACTION_REQUIRED, ACTION_FOLLOW_UP, ACTION_DONE]

# ------------------------------------------------------------------- outcomes

OUTCOME_REJECTED = "rejected"
OUTCOME_OFFER = "offer"
OUTCOME_ASSESSMENT = "assessment"
OUTCOME_INTERVIEW = "interview"
OUTCOME_FOLLOW_UP = "follow_up"
OUTCOME_NO_RESPONSE = "no_response"
OUTCOME_WITHDRAWN = "withdrawn"
OUTCOME_OTHER = "other"

OUTCOMES = [
    OUTCOME_REJECTED,
    OUTCOME_OFFER,
    OUTCOME_ASSESSMENT,
    OUTCOME_INTERVIEW,
    OUTCOME_FOLLOW_UP,
    OUTCOME_NO_RESPONSE,
    OUTCOME_WITHDRAWN,
    OUTCOME_OTHER,
]

# ------------------------------------------------------------------ reminders

REMINDER_CHECK_BACK = "check_back"
REMINDER_DEADLINE = "deadline"
REMINDER_INTERVIEW = "interview"
REMINDER_FOLLOW_UP = "follow_up"

REMINDER_PENDING = "pending"
REMINDER_DONE = "done"
REMINDER_DISMISSED = "dismissed"
REMINDER_CANCELLED = "cancelled"

# --------------------------------------------------------------------- events

EVENT_CREATED = "created"
EVENT_UPDATED = "updated"
EVENT_EMAIL = "email"
EVENT_OUTCOME = "outcome"
EVENT_SNOOZE = "snooze"
EVENT_REMINDER = "reminder"
EVENT_NOTE = "note"

PARSER_VERSION = "rules-v1"


def json_load(value: Optional[str], default: Any = None) -> Any:
    if value is None:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def serialize_application(row: dict) -> dict:
    return dict(row)


def serialize_email(row: dict) -> dict:
    data = dict(row)
    data["parsed"] = json_load(data.pop("parsed_json", None), {})
    return data


def serialize_reminder(row: dict) -> dict:
    data = dict(row)
    data["payload"] = json_load(data.pop("payload_json", None), {})
    return data


def serialize_event(row: dict) -> dict:
    data = dict(row)
    data["data"] = json_load(data.pop("data_json", None), {})
    return data
