"""Date and response-window parsing for pasted application emails.

The parser intentionally prefers explicit dates and stated windows, then falls
back to a configurable default. All persisted timestamps are UTC epoch ms.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import parser as date_parser

from ..timeutil import MS_PER_DAY, now_ms, to_ms

_WORD_NUMBERS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
}

_MONTHS = (
    "january|february|march|april|may|june|july|august|september|october|"
    "november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)

_DATE_TEXT = rf"(?:{_MONTHS})\.?\s+\d{{1,2}}(?:,?\s+\d{{4}})?|\d{{1,2}}[/-]\d{{1,2}}[/-]\d{{2,4}}|\d{{4}}-\d{{2}}-\d{{2}}"
_DATE_RE = re.compile(_DATE_TEXT, re.IGNORECASE)
_HAS_TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\b|\b(?:am|pm|noon|midnight)\b", re.IGNORECASE)


def get_tz(name: Optional[str]):
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def _number(raw: str) -> Optional[int]:
    raw = raw.strip().lower()
    if raw.isdigit():
        return int(raw)
    return _WORD_NUMBERS.get(raw)


def _local_nine(day: datetime, tz_name: Optional[str]) -> datetime:
    tz = get_tz(tz_name)
    return day.astimezone(tz).replace(hour=9, minute=0, second=0, microsecond=0)


def _parse_date(raw: str, anchor_ms: int, tz_name: Optional[str]) -> Optional[int]:
    raw = raw.strip().strip(".,;:")
    if not raw:
        return None
    anchor = datetime.fromtimestamp(anchor_ms / 1000, tz=timezone.utc).astimezone(
        get_tz(tz_name)
    )
    try:
        parsed = date_parser.parse(raw, default=anchor, fuzzy=False)
    except (ValueError, TypeError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=get_tz(tz_name))
    # Yearless dates that land in the past almost always mean next year.
    if not re.search(r"\b\d{4}\b", raw) and parsed < anchor - timedelta(days=30):
        try:
            parsed = parsed.replace(year=parsed.year + 1)
        except ValueError:
            return None
    if not _HAS_TIME_RE.search(raw):
        parsed = _local_nine(parsed, tz_name)
    return to_ms(parsed)


def add_business_days(start: datetime, days: int) -> datetime:
    current = start
    remaining = max(0, days)
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def extract_response_window(
    text: str, anchor_ms: Optional[int] = None, timezone_name: Optional[str] = None
) -> dict:
    """Return the most likely response window from an email body.

    Shape:
      {kind, raw, days, business_days, explicit_date, source, ambiguous}
    """
    anchor_ms = anchor_ms or now_ms()
    compact = re.sub(r"\s+", " ", text or "")
    lower = compact.lower()

    # Explicit deadlines take priority: "by Jan 20", "no later than ...",
    # "on or before ...". Deliberately skip "before ..." alone because it is
    # often unrelated marketing copy.
    explicit_patterns = [
        rf"(?:by|no later than|on or before)\s+({_DATE_TEXT})",
        rf"(?:deadline|due date|due|respond by|apply by|complete by)\s*[:\-]?\s*({_DATE_TEXT})",
    ]
    for pattern in explicit_patterns:
        match = re.search(pattern, compact, re.IGNORECASE)
        if match:
            raw = match.group(1)
            date_ms = _parse_date(raw, anchor_ms, timezone_name)
            if date_ms:
                return {
                    "kind": "explicit_date",
                    "raw": match.group(0),
                    "days": None,
                    "business_days": False,
                    "explicit_date": date_ms,
                    "source": "explicit_date",
                    "ambiguous": not bool(re.search(r"\b\d{4}\b", raw)),
                }

    # Relative windows: "within 2 weeks", "7-10 business days",
    # "we'll get back to you in two weeks".
    window_patterns = [
        r"(?:within|in|after)\s+(\d+|" + "|".join(_WORD_NUMBERS) + r")\s*(?:-|to)?\s*(\d+|" + "|".join(_WORD_NUMBERS) + r")?\s*(business\s+)?(days?|weeks?|months?)",
        r"(?:review|process|take|takes|taking|typically|usually)[^.\n]{0,40}?(\d+|" + "|".join(_WORD_NUMBERS) + r")\s*(?:-|to)?\s*(\d+|" + "|".join(_WORD_NUMBERS) + r")?\s*(business\s+)?(days?|weeks?|months?)",
        r"(?:check back|follow up|reach out|contact you|hear from us)[^.\n]{0,50}?(?:within|in|after)\s+(\d+|" + "|".join(_WORD_NUMBERS) + r")\s*(?:-|to)?\s*(\d+|" + "|".join(_WORD_NUMBERS) + r")?\s*(business\s+)?(days?|weeks?|months?)",
    ]
    for pattern in window_patterns:
        match = re.search(pattern, lower)
        if not match:
            continue
        first = _number(match.group(1))
        second = _number(match.group(2)) if match.group(2) else None
        count = second or first
        if not count:
            continue
        unit = match.group(4).lower()
        business = bool(match.group(3)) or "business" in match.group(0)
        if unit.startswith("week"):
            days = count * 7
        elif unit.startswith("month"):
            days = count * 30
        else:
            days = count
        return {
            "kind": "window",
            "raw": compact[match.start() : match.end()],
            "days": days,
            "business_days": business,
            "explicit_date": None,
            "source": "stated_window",
            "ambiguous": False,
        }

    return {
        "kind": "default",
        "raw": "",
        "days": None,
        "business_days": False,
        "explicit_date": None,
        "source": "default",
        "ambiguous": True,
    }


def resolve_check_back(
    window: dict,
    anchor_ms: Optional[int],
    default_days: int = 7,
    timezone_name: Optional[str] = None,
) -> dict:
    """Turn a parsed response window into an absolute check-back timestamp."""
    anchor_ms = anchor_ms or now_ms()
    if window.get("explicit_date"):
        return {
            "check_back_at": int(window["explicit_date"]),
            "check_back_source": "explicit_date",
        }

    if window.get("days"):
        anchor = datetime.fromtimestamp(anchor_ms / 1000, tz=timezone.utc).astimezone(
            get_tz(timezone_name)
        )
        if window.get("business_days"):
            target = add_business_days(anchor, int(window["days"]))
        else:
            target = anchor + timedelta(days=int(window["days"]))
        return {
            "check_back_at": to_ms(_local_nine(target, timezone_name)),
            "check_back_source": "stated_window",
        }

    anchor = datetime.fromtimestamp(anchor_ms / 1000, tz=timezone.utc).astimezone(
        get_tz(timezone_name)
    )
    target = anchor + timedelta(days=max(1, int(default_days)))
    return {
        "check_back_at": to_ms(_local_nine(target, timezone_name)),
        "check_back_source": "default",
    }


def reminder_offsets(due_ms: int) -> list[tuple[str, int]]:
    """Reminder timestamps for a deadline/interview: 24h and 1h before."""
    return [
        ("24h before", due_ms - MS_PER_DAY),
        ("1h before", due_ms - 3_600_000),
    ]


def extract_date_candidates(text: str) -> list[str]:
    return [m.group(0) for m in _DATE_RE.finditer(text or "")]


def parse_date(raw: str, anchor_ms: Optional[int] = None, timezone_name: Optional[str] = None) -> Optional[int]:
    """Public wrapper for parsing a single date expression."""
    return _parse_date(raw, anchor_ms or now_ms(), timezone_name)


def extract_event_date(
    text: str,
    *,
    anchor_ms: Optional[int] = None,
    timezone_name: Optional[str] = None,
    keywords: tuple[str, ...] = ("interview", "assessment", "deadline", "due"),
) -> Optional[int]:
    """Find a date in a sentence that also mentions an event keyword."""
    anchor_ms = anchor_ms or now_ms()
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        lower = sentence.lower()
        if not any(word in lower for word in keywords):
            continue
        match = _DATE_RE.search(sentence)
        if not match:
            continue
        parsed = _parse_date(match.group(0), anchor_ms, timezone_name)
        if parsed:
            return parsed
    return None
