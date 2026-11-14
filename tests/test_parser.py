from __future__ import annotations

from datetime import datetime, timezone

from app.parser.dates import extract_response_window, resolve_check_back
from app.parser.pipeline import parse_email

ANCHOR = int(datetime(2026, 11, 1, 12, tzinfo=timezone.utc).timestamp() * 1000)


def test_application_confirmation_defaults_to_applied_and_stated_window():
    draft = parse_email(
        "Thank you for applying to the Software Engineer Intern position at PayPal. "
        "We will review your application within 2 weeks.",
        subject="Application received",
        received_at=ANCHOR,
    )
    assert draft["stage"] == "applied"
    assert draft["company"] == "PayPal"
    assert draft["role"] == "Software Engineer Intern"
    assert draft["check_back_source"] == "stated_window"
    assert draft["check_back_at"] is not None


def test_rejection_wins_and_closes_no_check_back():
    draft = parse_email(
        "We regret to inform you that we will not be moving forward with your "
        "application for Data Intern at Figma.",
        received_at=ANCHOR,
    )
    assert draft["stage"] == "rejected"
    assert draft["company"] == "Figma"
    assert draft["role"] == "Data Intern"
    assert draft["check_back_at"] is None
    assert draft["next_action_at"] is None
    assert draft["action_state"] == "waiting"


def test_assessment_deadline_becomes_next_action():
    draft = parse_email(
        "Please complete the online assessment by November 20.",
        received_at=ANCHOR,
    )
    assert draft["stage"] == "assessment"
    assert draft["check_back_source"] == "deadline"
    assert draft["next_action_at"] is not None
    assert "assessment" in draft["next_action"].lower()


def test_offer_explicit_deadline():
    draft = parse_email(
        "We are pleased to offer you the Software Intern position at Ramp. "
        "Please respond by December 1.",
        received_at=ANCHOR,
    )
    assert draft["stage"] == "offer"
    assert draft["company"] == "Ramp"
    assert draft["next_action_at"] is not None
    assert draft["check_back_at"] is None


def test_unknown_email_is_low_confidence_applied():
    draft = parse_email("Hello, sharing a quick update.", received_at=ANCHOR)
    assert draft["stage"] == "applied"
    assert draft["confidence"] < 0.5


def test_default_check_back_uses_preferences():
    window = extract_response_window("No timeline mentioned.", anchor_ms=ANCHOR)
    resolved = resolve_check_back(window, ANCHOR, default_days=5)
    assert resolved["check_back_source"] == "default"
    days = (resolved["check_back_at"] - ANCHOR) / 86_400_000
    assert 4 < days < 6


def test_company_from_domain_but_not_ats():
    draft = parse_email(
        "Your application has been received.",
        from_email="careers@paypal.com",
        received_at=ANCHOR,
    )
    assert draft["company"] == "Paypal"
    ats = parse_email(
        "Your application has been received.",
        from_email="no-reply@greenhouse.io",
        received_at=ANCHOR,
    )
    assert ats["company"] == ""
