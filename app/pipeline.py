"""Orchestration: pull emails from Gmail, classify, store.

`sync()` can be driven by:
  * the dashboard's "Refresh" button (runs in a background thread), or
  * a cron job / `bin/refresh.py` for headless, scheduled syncs.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .classify import (
    age_flag,
    classify,
    compute_action,
    extract_company,
    guess_role,
)
from .config import settings
from .db import Database
from .gmail_client import GmailClient
from .models import EmailMessage, SyncResult

# Threads whose latest message ends in a terminal stage need no nudge.
_TERMINAL_STAGES = ("offer", "rejection", "other")

_INTERVIEW_ONLY = re.compile(r"^(interview|on.?site|phone screen|screening)$", re.I)

_NOISE = (
    "unsubscribe",
    "you're receiving this because",
    "daily digest",
    "weekly digest",
    "newsletter",
    "new follower",
    "do not reply to this email",
    "promotions",
)


def _filter_relevant(email: EmailMessage) -> bool:
    """Drop obvious newsletter/notification noise; keep recruiting threads."""
    key = f"{email.subject} {email.snippet}".lower()
    if any(n in key for n in _NOISE):
        return False
    return True


def sync(
    client: GmailClient,
    db: Database,
    full: bool = False,
    max_messages: int | None = None,
) -> SyncResult:
    """Scan Gmail, classify and upsert into the local database.

    full=False does an incremental sync from the last sync timestamp.
    Returns a SyncResult summary.
    """
    result = SyncResult(full=full)

    if full:
        query = f"newer_than:{settings.search_history_days}d"
    else:
        last = db.get_meta("last_sync")
        query = f"after:{last}" if last else f"newer_than:{settings.search_history_days}d"

    emails: list[EmailMessage] = []
    for envelope in client.list_messages(query):
        if max_messages and result.scanned >= max_messages:
            break
        result.scanned += 1
        try:
            email = client.fetch_metadata(envelope["id"])
        except Exception:
            # A single message failing shouldn't abort the whole sync.
            result.skipped += 1
            continue

        if not _filter_relevant(email):
            result.skipped += 1
            continue

        email.company = extract_company(email.from_email, email.from_name)
        email.role = guess_role(email.subject)
        email.stage = classify(email)
        emails.append(email)

    # needs-action is a *conversation* property: only the newest message in a
    # thread may be flagged, and only while that thread is still live.
    latest_per_thread: dict[str, EmailMessage] = {}
    for email in emails:
        if latest_per_thread.get(email.thread_id, email).date_ts <= email.date_ts:
            latest_per_thread[email.thread_id] = email

    for email in emails:
        is_latest = latest_per_thread.get(email.thread_id) is email
        if not is_latest or email.stage in _TERMINAL_STAGES:
            email.needs_action = False
            email.action_reason = ""
        else:
            act, reason = compute_action(email)
            if not act:
                act, reason = age_flag(email, settings.followup_after_days)
            email.needs_action = act
            email.action_reason = reason

        inserted = db.upsert_message(email.to_dict())
        result.saved += int(inserted)
        result.updated += int(not inserted)

    db.set_meta("last_sync", datetime.now(tz=timezone.utc).date().isoformat())
    return result