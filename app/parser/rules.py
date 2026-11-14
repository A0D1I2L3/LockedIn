"""Deterministic rules for classifying pasted recruiting emails.

The output is always editable by the user. Rules favour high precision over
cleverness: an unrecognised email becomes "Applied" with low confidence rather
than a confident wrong stage.
"""

from __future__ import annotations

import re
from typing import Optional

from ..models import (
    ACTION_REQUIRED,
    ACTION_WAITING,
    STAGE_APPLIED,
    STAGE_ASSESSMENT,
    STAGE_INTERVIEW,
    STAGE_OFFER,
    STAGE_REJECTED,
    STAGE_WITHDRAWN,
    STAGES,
)

_ATS_DOMAINS = {
    "greenhouse.io",
    "lever.co",
    "workday.com",
    "myworkdayjobs.com",
    "icims.com",
    "smartrecruiters.com",
    "linkedin.com",
    "indeed.com",
    "hackerrank.com",
    "hackerrankforwork.com",
    "codesignal.com",
    "codility.com",
    "unstop.com",
    "handshake.com",
    "joinhandshake.com",
    "wellfound.com",
    "angel.co",
    "glassdoor.com",
}

_REJECTION = [
    "unfortunately",
    "not moving forward",
    "will not be moving forward",
    "not selected",
    "regret to inform",
    "will not be proceeding",
    "decided not to move forward",
    "not successful",
    "position has been filled",
    "no longer under consideration",
    "not proceed with your application",
    "wish you the best",
]
_WITHDRAWN = ["withdraw", "withdrawn", "withdrawing your application"]
_OFFER = [
    "offer letter",
    "pleased to offer",
    "excited to offer",
    "happy to offer",
    "verbal offer",
    "formal offer",
    "offer of employment",
    "we would like to offer",
    "accepted for the position",
]
_ASSESSMENT = [
    "coding test",
    "online assessment",
    "hackerrank",
    "codesignal",
    "codility",
    "take-home",
    "take home",
    "technical assessment",
    "technical test",
    "assessment",
    "challenge link",
    "coding challenge",
    "online test",
    "oa link",
]
_INTERVIEW = [
    "interview",
    "phone screen",
    "recruiter screen",
    "schedule a call",
    "schedule a time",
    "schedule your",
    "availability",
    "calendly",
    "hiring manager",
    "zoom",
    "google meet",
    "teams meeting",
    "next round",
]
_APPLIED = [
    "thank you for applying",
    "thanks for applying",
    "application received",
    "we received your application",
    "received your application",
    "application submitted",
    "application has been submitted",
    "successfully applied",
    "your application was submitted",
    "application confirmation",
    "we have your application",
    "your application for",
]


def _find(text: str, phrases: list[str]) -> Optional[str]:
    for phrase in phrases:
        if phrase in text:
            return phrase
    return None


def classify_stage(text: str, subject: str = "") -> dict:
    """Return {stage, confidence, evidence} for an email."""
    body = (text or "").lower()
    head = (subject or "").lower()
    haystack = f"{head}\n{body}"

    rejection = _find(haystack, _REJECTION)
    if rejection:
        return {"stage": STAGE_REJECTED, "confidence": 0.98, "evidence": rejection}

    withdrawn = _find(haystack, _WITHDRAWN)
    if withdrawn:
        return {"stage": STAGE_WITHDRAWN, "confidence": 0.95, "evidence": withdrawn}

    offer = _find(haystack, _OFFER)
    if offer:
        return {"stage": STAGE_OFFER, "confidence": 0.97, "evidence": offer}

    assessment = _find(haystack, _ASSESSMENT)
    if assessment:
        return {"stage": STAGE_ASSESSMENT, "confidence": 0.92, "evidence": assessment}

    interview = _find(haystack, _INTERVIEW)
    if interview:
        return {"stage": STAGE_INTERVIEW, "confidence": 0.88, "evidence": interview}

    applied = _find(haystack, _APPLIED)
    if applied:
        return {"stage": STAGE_APPLIED, "confidence": 0.92, "evidence": applied}

    return {"stage": STAGE_APPLIED, "confidence": 0.3, "evidence": ""}


def extract_headers(raw: str) -> dict:
    """Pull Subject/From hints out of a pasted RFC822-style message."""
    subject = ""
    from_email = ""
    match = re.search(r"^\s*Subject:\s*(.+)$", raw or "", re.IGNORECASE | re.MULTILINE)
    if match:
        subject = match.group(1).strip()
    match = re.search(r"^\s*From:\s*(.+)$", raw or "", re.IGNORECASE | re.MULTILINE)
    if match:
        line = match.group(1)
        email_match = re.search(r"[\w.+-]+@[\w.-]+\.\w+", line)
        if email_match:
            from_email = email_match.group(0).lower()
    return {"subject": subject, "from_email": from_email}


def humanize_domain(domain: str) -> str:
    root = domain.lower().split(".")[0]
    root = root.replace("-", " ").replace("_", " ")
    return " ".join(part.capitalize() for part in root.split())


def _clean_company(value: str) -> str:
    value = re.split(
        r"\s+(?:has|have|was|is|for|to|regarding|about|team|careers|and|with|"
        r"position|role|opening|internship)\b|[.,!;\n]",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    value = re.sub(r"\s+", " ", value).strip(" -–—:.")
    return value[:80]


def extract_company(text: str, *, from_email: str = "", subject: str = "") -> str:
    haystack = f"{subject}\n{text}"
    patterns = [
        r"(?:thank you|thanks) for applying (?:to|for) (?:the\s+)?[^.\n,]{1,80}?\s+(?:at|with)\s+([A-Z][^.\n,]{1,70})",
        r"application (?:to|at)\s+([A-Z][^.\n,]{1,70})",
        r"application (?:for|as)\s+[^.\n,]{1,80}?\s+(?:at|with)\s+([A-Z][^.\n,]{1,70})",
        r"applied (?:to|at)\s+([A-Z][^.\n,]{1,70})",
        r"applied (?:for|as)\s+[^.\n,]{1,80}?\s+(?:at|with)\s+([A-Z][^.\n,]{1,70})",
        r"(?:position|role|opening|opportunity) (?:at|with)\s+([A-Z][^.\n,]{1,70})",
        r"(?:joining|join) (?:the\s+)?([A-Z][^.\n,]{1,70}?)\s+(?:team|as)\b",
        r"from\s+([A-Z][^.\n,]{1,70}?)\s+(?:team|recruiting|talent)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, haystack)
        if match:
            company = _clean_company(match.group(1))
            if company:
                return company

    if from_email and "@" in from_email:
        domain = from_email.rsplit("@", 1)[-1]
        if domain not in _ATS_DOMAINS:
            company = humanize_domain(domain)
            if company:
                return company
    return ""


def _clean_role(value: str) -> str:
    value = re.split(
        r"\s+(?:at|with|position|role|has|was|is|and|for|,|\.|\n)",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    value = re.sub(r"\s+", " ", value).strip(" -–—:.")
    value = re.sub(r"^(?:the|a|an)\s+", "", value, flags=re.IGNORECASE)
    return value[:100]


def extract_role(text: str, *, subject: str = "") -> str:
    haystack = f"{subject}\n{text}"
    patterns = [
        r"(?:application|applied|candidacy)\s+(?:for|to|as)\s+(?:the\s+)?([A-Z][^.\n,]{2,90}?)(?=\s+(?:at|with|position|role|has|was|is|and|,|\.|\n)|$)",
        r"(?:the|a|an)\s+([A-Z][\w /&+.\-]{2,70}?)\s+(?:position|role|internship|opening)\b",
        r"(?:position|role|opening)\s+(?:of|for)\s+([A-Z][^.\n,]{2,80})",
        r"(?:subject|role)\s*[:\-]\s*([^\n]{2,80})",
    ]
    for pattern in patterns:
        match = re.search(pattern, haystack)
        if match:
            role = _clean_role(match.group(1))
            if role:
                return role
    return ""


def extract_next_action(stage: str, text: str) -> dict:
    body = (text or "").lower()
    if stage in {STAGE_REJECTED, STAGE_WITHDRAWN}:
        return {"next_action": "No action needed", "action_state": ACTION_WAITING}
    if stage == STAGE_OFFER:
        return {"next_action": "Review the offer", "action_state": ACTION_REQUIRED}
    if stage == STAGE_ASSESSMENT:
        return {"next_action": "Complete the assessment", "action_state": ACTION_REQUIRED}
    if stage == STAGE_INTERVIEW:
        if "availability" in body or "schedule" in body or "calendly" in body:
            return {"next_action": "Reply with availability", "action_state": ACTION_REQUIRED}
        return {"next_action": "Prepare for the interview", "action_state": ACTION_REQUIRED}

    asks = ["complete", "submit", "schedule", "reply", "availability", "confirm", "send"]
    if any(word in body for word in asks):
        return {"next_action": "Follow the instructions in the email", "action_state": ACTION_REQUIRED}
    return {"next_action": "Wait for a response", "action_state": ACTION_WAITING}


def normalize_stage(value: str) -> str:
    value = (value or "").strip().lower()
    if value in STAGES:
        return value
    aliases = {
        "application": STAGE_APPLIED,
        "applied": STAGE_APPLIED,
        "submitted": STAGE_APPLIED,
        "oa": STAGE_ASSESSMENT,
        "coding_test": STAGE_ASSESSMENT,
        "test": STAGE_ASSESSMENT,
        "interviewing": STAGE_INTERVIEW,
        "accepted": STAGE_OFFER,
        "offer": STAGE_OFFER,
        "rejection": STAGE_REJECTED,
        "rejected": STAGE_REJECTED,
        "other": STAGE_APPLIED,
    }
    return aliases.get(value, STAGE_APPLIED)
