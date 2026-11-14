"""Small time helpers shared by the API, DB, and parser layers."""

from __future__ import annotations

from datetime import datetime, timezone

MS_PER_DAY = 86_400_000


def now_ms() -> int:
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def to_ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def from_ms(ms: int | None) -> datetime | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def days_between(start_ms: int | None, end_ms: int | None) -> int:
    if not start_ms or not end_ms:
        return 0
    return int((end_ms - start_ms) / MS_PER_DAY)
