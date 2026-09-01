"""Rule-based classifier that turns raw emails into pipeline stages.

It looks at the subject, snippet and sender and scores each candidate stage.
Scores are deliberately hand-tuned for the internship-application use case;
edit the keyword tables to tune it to your inbox.

Classification is *best effort* — you can always override the stage for a
specific message from the dashboard, which is stored as `stage_override`.
"""

from __future__ import annotations

import html
import re
from typing import Optional

from .config import settings
from .models import EmailMessage, STAGE_OFFER, STAGE_OTHER

# Well-known domains that belong to Gmail users (i.e. individual recruiters
# or staffing agencies working from a personal account). For these we fall
# back to the sender display name instead of a domain-derived company.
_PERSONAL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
}

# Any other domain with these trailing parts is treated as a generic
# webmail / relay address too.
_PERSONAL_SUFFIXES = (".edu",)

# Map sender domains to a friendlier company name. Add your own entries.
# Keys are matched against the *final* domain (e.g. "brex.com").
COMPANY_OVERRIDES: dict[str, str] = {
    "amazon.com": "Amazon",
    "apple.com": "Apple",
    "bloomberg.com": "Bloomberg",
    "citadel.com": "Citadel",
    "datadoghq.com": "Datadog",
    "facebook.com": "Meta",
    "google.com": "Google",
    "linkedin.com": "LinkedIn",
    "microsoft.com": "Microsoft",
    "nvidia.com": "NVIDIA",
    "stripe.com": "Stripe",
    "twosigma.com": "Two Sigma",
    "wayfair.com": "Wayfair",
}

# Fallback company name from a bare domain, e.g. "janestreet.com" -> "Jane Street".
_CAMEL_SPLIT = re.compile(r"(?<=[a-z])(?=[A-Z])")
_KNOWN_MULTI = {
    "capsensixx": "CapSensixx",
    "hired": "Hired",
    "janestreet": "Jane Street",
    "liftlab": "LiftLab",
    "payscale": "PayScale",
    "twosigma": "Two Sigma",
}

# Scores per stage, matched case-insensitively against subject + snippet.
_STAGE_KEYWORDS: dict[str, dict[str, int]] = {
    "application": {
        "application received": 6,
        "we have received your application": 6,
        "thanks for applying": 6,
        "thank you for applying": 6,
        "thank you for your application": 6,
        "application submitted": 6,
        "application has been received": 6,
        "has been received": 5,
        "received your application": 6,
        "applying to ": 3,
        "applied to": 3,
        "confirmation": 3,
        "your application for": 3,
        "application for": 3,
        "application has been": 4,
        "we received your": 4,
        "application status": 4,
    },
    "interview": {
        "interview": 8,
        "phone screen": 8,
        "hiring manager": 5,
        "recruiter": 4,
        "take-home": 7,
        "take home": 7,
        "coding assessment": 7,
        "technical challenge": 7,
        "technical assessment": 7,
        "online assessment": 7,
        "coding challenge": 7,
        "we'd love to get to know": 6,
        "schedule a time": 6,
        "availability for": 5,
        "selecting a time": 5,
        "calendly": 3,
        "zoom": 2,
        "google meet": 2,
        "next step": 5,
        "move forward in the process": 5,
        "moving forward in the hiring process": 5,
    },
    "offer": {
        "offer": 8,
        "we are excited to offer": 10,
        "we're excited to offer": 10,
        "welcome you aboard": 8,
        "welcome aboard": 8,
        "congratulations": 8,
        "pleased to offer": 9,
        "we would like to extend": 9,
        "extend an offer": 10,
        "employment agreement": 4,
        "offer letter": 9,
        "benefits enrollment": 5,
        "onboarding": 4,
    },
    "rejection": {
        "unfortunately": 6,
        "not to move forward": 7,
        "won't be moving forward": 7,
        "we will not be moving forward": 7,
        "not be moving forward": 7,
        "move forward with other candidates": 8,
        "other candidates": 6,
        "after careful consideration": 6,
        "not the right fit": 6,
        "we have decided": 4,
        "regret to inform": 8,
        "will not be progressing": 7,
        "not moving forward": 7,
        "at this time": 3,
        "freeze": 4,
        "filled this role": 6,
        "pursue other candidates": 7,
        "resume": 1,  # weak signal; almost everything says 'resume'
    },
}

# Snippets/subjects that mean *we* need to do something.
_ACTION_KEYWORDS = {
    "please let us know": 8,
    "please respond": 8,
    "let us know": 6,
    "are you interested": 7,
    "confirm your": 6,
    "confirm": 4,
    "please confirm": 7,
    "select a time": 8,
    "schedule a time": 8,
    "choose a time": 8,
    "pick a time": 8,
    "book a": 5,
    "your availability": 7,
    "availability for": 7,
    "are you available": 7,
    "interested in speaking": 8,
    "we'd like to schedule": 8,
    "would love to get": 6,
}


def _clean_domain(domain: str) -> str:
    """Keep the registrable part of a domain, drop subdomains."""
    domain = domain.strip().lower()
    if domain in _PERSONAL_DOMAINS:
        return domain
    parts = domain.split(".")
    # Try to strip typical subdomains used by mail relays.
    no_www = [p for p in parts if p not in ("www", "mail", "email", "sa")] or parts
    # simple heuristic: after dropping leading subdomain segments, take the
    # last two meaningful tokens
    if len(no_www) > 2:
        # e.g. "careers.jane.street" doesn't exist; but "hr.events.sea" does.
        # Take last three if first part looks like a service token, else last two.
        if no_www[0] in ("careers", "hiring", "hr", "jobs", "talent", "apply"):
            no_www = no_www[1:]
        if len(no_www) > 2:
            no_www = no_www[-2:]
    return ".".join(no_www)


def humanize_domain(domain: str) -> str:
    """Turn a registrable domain into a display name.

    e.g. janestreet.com  -> Jane Street
         twosigma.com    -> Twosigma
    """
    core = domain.split(".")[0]
    if core in _KNOWN_MULTI:
        return _KNOWN_MULTI[core]
    # Insert a space before each embedded capital (camelCase) and then
    # normalise the rest of the letters to lower-case.
    spaced = _CAMEL_SPLIT.sub(" ", core)
    words = spaced.split()
    if not words:
        return core.title()
    # Title-case words, but keep already-capitalised acronyms and lowercase
    # articles for common patterns like "Jane Street".
    out = []
    for w in words:
        if w in ("and", "of", "de", "la"):
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out)


def extract_company(from_email: str, from_name: str) -> str:
    """Best-effort company name from a sender email address."""
    addr = (from_email or "").strip().lower()
    if not addr:
        return (from_name or "").strip() or "Unknown"
    domain = addr.rsplit("@", 1)[-1]
    clean = _clean_domain(domain)

    if clean in _PERSONAL_DOMAINS or clean.endswith(_PERSONAL_SUFFIXES):
        # Individual person — use the display name if available.
        return (from_name or "").strip() or humanize_domain(clean)

    if clean in COMPANY_OVERRIDES:
        return COMPANY_OVERRIDES[clean]
    return humanize_domain(clean)


_ROLE_PATTERNS = [
    re.compile(r"(?:for|as|role|position)\s+(?:an?\s+)?(.{0,60}?(?:intern|internship|internship program)[^.]*?)$", re.I),
    re.compile(r"(?:application for|position of|internship as|intern as)\s+(.{0,60}?)$", re.I),
    re.compile(r"(.{0,50}?intern\b)", re.I),
]


def guess_role(subject: str) -> str:
    """Try to pull the role out of a subject line like
    'Your application for Software Engineering Internship'."""
    subj = html.unescape((subject or "").strip())
    for pat in _ROLE_PATTERNS:
        m = pat.search(subj)
        if m:
            role = re.sub(r"[^\w+./\-& ]", "", m.group(1)).strip()
            role = re.sub(r"\s+", " ", role)[:60]
            if role:
                return role
    return ""


def classify(email: EmailMessage, override_stage: Optional[str] = None) -> str:
    """Return the pipeline stage for an email."""
    if override_stage:
        return override_stage

    text = f"{email.subject} {email.snippet}".lower()
    scores: dict[str, int] = {"application": 0, "interview": 0, "offer": 0, "rejection": 0}
    for stage, table in _STAGE_KEYWORDS.items():
        for kw, score in table.items():
            if kw in text:
                scores[stage] += score
    best, best_score = STAGE_OTHER, 0
    for stage, score in scores.items():
        if score > best_score:
            best, best_score = stage, score
    if best_score >= 5:
        return best
    return STAGE_OTHER


def compute_action(email: EmailMessage, older_than_days: int = 2) -> tuple[bool, str]:
    """Decide whether this email looks like it needs a follow-up from us.

    Returns (needs_action, reason). We look at obvious ask-keywords; the
    age-based escalation is handled in the pipeline once we know how old the
    email is.
    """
    text = f"{email.subject} {email.snippet}".lower()
    best_reason, best_score = "", 0
    for kw, score in _ACTION_KEYWORDS.items():
        if kw in text and score > best_score:
            best_reason, best_score = kw, score
    if best_score >= 6:
        return True, f"email asks: “{best_reason}”"
    return False, ""


def age_flag(email: EmailMessage, older_than_days: int) -> tuple[bool, str]:
    """Flag older company emails in a non-terminal stage that we haven't
    heard back on (heuristic — a reminder to nudge the recruiter)."""
    from datetime import datetime, timezone

    if not email.date_ts:
        return False, ""
    now = datetime.now(tz=timezone.utc).timestamp() * 1000
    age_days = (now - email.date_ts) / 86_400_000
    if age_days >= older_than_days and email.stage in ("application", "interview", "offer"):
        return True, f"no updates in {int(age_days)}d — consider a nudge"
    return False, ""


