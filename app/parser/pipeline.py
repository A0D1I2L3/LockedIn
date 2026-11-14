"""Parse a pasted recruiting email into an editable application draft."""

from __future__ import annotations

import re
from typing import Optional

from ..models import (
    ACTION_REQUIRED,
    ACTION_WAITING,
    PARSER_VERSION,
    STAGE_APPLIED,
    STAGE_ASSESSMENT,
    STAGE_INTERVIEW,
    STAGE_OFFER,
    STAGE_REJECTED,
    STAGE_WITHDRAWN,
)
from ..timeutil import now_ms
from . import rules
from .dates import (
    extract_event_date,
    extract_response_window,
    parse_date,
    resolve_check_back,
)
from .llm import LLMConfig, parse_with_llm

TERMINAL_STAGES = {STAGE_REJECTED, STAGE_WITHDRAWN}


def extract_location(text: str) -> str:
    match = re.search(
        r"(?:location|based in|office in|work location)\s*[:\-]?\s*"
        r"([A-Z][A-Za-z .'-]{1,60}(?:,\s*[A-Z]{2})?)",
        text or "",
    )
    if match:
        return match.group(1).strip(" .,-")[:80]
    if re.search(r"\bremote\b", text or "", re.IGNORECASE):
        return "Remote"
    return ""


def _merge_hints(value: str, hint: Optional[str]) -> str:
    hint = (hint or "").strip()
    return hint or value


def parse_email(
    raw: str,
    *,
    subject: str = "",
    from_email: str = "",
    received_at: Optional[int] = None,
    timezone_name: str = "UTC",
    default_follow_up_days: int = 7,
    llm_config: Optional[LLMConfig] = None,
    parser_mode: str = "auto",
    company_hint: str = "",
    role_hint: str = "",
    stage_hint: str = "",
) -> dict:
    """Return an application draft plus parser evidence.

    `parser_mode`: "rules", "llm", or "auto" (rules first, LLM for low
    confidence). LLM failures silently fall back to rules.
    """
    raw = raw or ""
    anchor_ms = int(received_at or now_ms())
    headers = rules.extract_headers(raw)
    subject = (subject or headers["subject"] or "").strip()
    from_email = (from_email or headers["from_email"] or "").strip()
    body = raw

    stage_result = rules.classify_stage(body, subject)
    stage = rules.normalize_stage(stage_hint) if stage_hint else stage_result["stage"]
    confidence = float(stage_result["confidence"])
    evidence = [stage_result["evidence"]] if stage_result["evidence"] else []
    parser = "rules"

    company = rules.extract_company(body, from_email=from_email, subject=subject)
    role = rules.extract_role(body, subject=subject)
    location = extract_location(body)
    next_action = rules.extract_next_action(stage, body)

    llm_data: Optional[dict] = None
    mode = (parser_mode or "auto").lower()
    should_try_llm = llm_config is not None and llm_config.configured and (
        mode in {"llm", "auto"} and (mode == "llm" or confidence < 0.65)
    )
    if should_try_llm:
        llm_data = parse_with_llm(body, subject=subject, config=llm_config)  # type: ignore[arg-type]

    llm_deadline: Optional[int] = None
    if llm_data:
        used_llm = False
        if llm_data.get("company") and not company_hint and not company:
            company = llm_data["company"]
            used_llm = True
        if llm_data.get("role") and not role_hint and not role:
            role = llm_data["role"]
            used_llm = True
        if llm_data.get("location") and not location:
            location = llm_data["location"]
            used_llm = True
        llm_stage = llm_data.get("stage")
        if llm_stage and not stage_hint and confidence < 0.65:
            stage = llm_stage
            confidence = max(confidence, float(llm_data.get("confidence") or 0.0))
            used_llm = True
        if llm_data.get("next_action"):
            next_action = {
                "next_action": llm_data["next_action"],
                "action_state": ACTION_REQUIRED,
            }
            used_llm = True
        if llm_data.get("deadline"):
            llm_deadline = parse_date(llm_data["deadline"], anchor_ms, timezone_name)
        if llm_data.get("evidence"):
            evidence.extend(str(item) for item in llm_data["evidence"])
        if used_llm:
            parser = "hybrid" if parser == "rules" and confidence >= 0.65 else "llm"
        elif mode == "llm":
            parser = "rules"

    company = _merge_hints(company, company_hint)
    role = _merge_hints(role, role_hint)
    if stage_hint:
        stage = rules.normalize_stage(stage_hint)
        next_action = rules.extract_next_action(stage, body)

    window = extract_response_window(body, anchor_ms=anchor_ms, timezone_name=timezone_name)
    if llm_data and llm_data.get("response_window_days"):
        window = {
            "kind": "window",
            "raw": "llm",
            "days": int(llm_data["response_window_days"]),
            "business_days": bool(llm_data.get("response_window_business_days")),
            "explicit_date": None,
            "source": "stated_window",
            "ambiguous": False,
        }
    resolved = resolve_check_back(
        window,
        anchor_ms=anchor_ms,
        default_days=default_follow_up_days,
        timezone_name=timezone_name,
    )

    event_date = extract_event_date(
        body,
        anchor_ms=anchor_ms,
        timezone_name=timezone_name,
        keywords=("interview", "assessment", "deadline", "due", "complete by", "submit by", "respond by"),
    )
    explicit_deadline = llm_deadline or event_date
    if not explicit_deadline and window.get("source") == "explicit_date":
        explicit_deadline = window.get("explicit_date")
    next_action_at: Optional[int] = None
    check_back_at: Optional[int] = resolved["check_back_at"]
    check_back_source: str = resolved["check_back_source"]

    if stage in TERMINAL_STAGES:
        check_back_at = None
        check_back_source = "none"
        next_action_at = None
        next_action = {
            "next_action": "No action needed",
            "action_state": ACTION_WAITING,
        }
    elif stage in {STAGE_ASSESSMENT, STAGE_INTERVIEW}:
        deadline = explicit_deadline
        next_action_at = deadline
        check_back_at = deadline or (anchor_ms + 2 * 86_400_000)
        check_back_source = "deadline" if deadline else "stage_default"
        if not next_action.get("next_action"):
            next_action = rules.extract_next_action(stage, body)
    elif stage == STAGE_OFFER:
        deadline = explicit_deadline
        next_action_at = deadline or (anchor_ms + 3 * 86_400_000)
        check_back_at = None
        check_back_source = "none"
    else:  # applied / waiting
        if llm_deadline and window["kind"] == "default":
            check_back_at = llm_deadline
            check_back_source = "explicit_date"

    if not next_action.get("next_action"):
        next_action = {
            "next_action": "Wait for a response",
            "action_state": ACTION_WAITING,
        }

    return {
        "company": company.strip()[:120],
        "role": role.strip()[:120],
        "location": location.strip()[:120],
        "stage": stage,
        "confidence": round(confidence, 2),
        "evidence": [item for item in evidence if item][:8],
        "parser": parser,
        "parser_version": PARSER_VERSION,
        "next_action": next_action["next_action"],
        "action_state": next_action["action_state"],
        "check_back_at": int(check_back_at) if check_back_at else None,
        "check_back_source": check_back_source,
        "next_action_at": int(next_action_at) if next_action_at else None,
        "received_at": anchor_ms,
        "subject": subject[:300],
        "from_email": from_email[:200],
        "response_window": window,
    }
