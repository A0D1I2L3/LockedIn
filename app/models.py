"""Domain models for emails flowing through the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# Pipeline stages an email can be classified into.
STAGE_APPLICATION = "application"  # application submitted / confirmed
STAGE_INTERVIEW = "interview"  # screening, interviews, assessments
STAGE_OFFER = "offer"  # offer / offer-related
STAGE_REJECTION = "rejection"  # rejection / pause
STAGE_OTHER = "other"  # everything else

STAGES = [
    STAGE_APPLICATION,
    STAGE_INTERVIEW,
    STAGE_OFFER,
    STAGE_REJECTION,
    STAGE_OTHER,
]

STAGE_LABELS = {
    STAGE_APPLICATION: "Applied",
    STAGE_INTERVIEW: "Interviewing",
    STAGE_OFFER: "Offer",
    STAGE_REJECTION: "Rejected",
    STAGE_OTHER: "Other",
}


@dataclass
class EmailMessage:
    """A single Gmail message relevant to an internship application."""

    id: str
    thread_id: str
    subject: str
    from_name: str
    from_email: str
    from_domain: str
    date_ts: int  # epoch milliseconds
    snippet: str = ""
    labels: list[str] = field(default_factory=list)

    # Set by the classifier.
    stage: str = STAGE_OTHER
    company: str = ""
    role: str = ""
    needs_action: bool = False
    action_reason: str = ""

    @property
    def display_date(self) -> str:
        from datetime import datetime, timezone

        if not self.date_ts:
            return ""
        dt = datetime.fromtimestamp(self.date_ts / 1000, tz=timezone.utc)
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "thread_id": self.thread_id,
            "subject": self.subject,
            "from_name": self.from_name,
            "from_email": self.from_email,
            "from_domain": self.from_domain,
            "date_ts": self.date_ts,
            "snippet": self.snippet,
            "labels": self.labels,
            "stage": self.stage,
            "company": self.company,
            "role": self.role,
            "needs_action": self.needs_action,
            "action_reason": self.action_reason,
        }

    @classmethod
    def from_row(cls, row: dict) -> "EmailMessage":
        return cls(
            id=row["id"],
            thread_id=row["thread_id"],
            subject=row["subject"] or "",
            from_name=row["from_name"] or "",
            from_email=row["from_email"] or "",
            from_domain=row["from_domain"] or "",
            date_ts=row["date_ts"] or 0,
            snippet=row["snippet"] or "",
            labels=row["labels"].split(",") if row["labels"] else [],
            stage=row["stage"] or STAGE_OTHER,
            company=row["company"] or "",
            role=row["role"] or "",
            needs_action=bool(row["needs_action"]),
            action_reason=row["action_reason"] or "",
        )


@dataclass
class SyncResult:
    """Summary of a sync run."""

    scanned: int = 0
    saved: int = 0
    updated: int = 0
    skipped: int = 0
    full: bool = False

    def to_dict(self) -> dict:
        return {
            "scanned": self.scanned,
            "saved": self.saved,
            "updated": self.updated,
            "skipped": self.skipped,
            "full": self.full,
        }


@dataclass
class FollowUp:
    """A company email that looks like it needs a reply."""

    message: EmailMessage
    days_old: int
    reason: Optional[str] = None

    def to_dict(self) -> dict:
        data = self.message.to_dict()
        data["days_old"] = self.days_old
        data["recommended_action"] = self.reason or self.message.action_reason
        return data