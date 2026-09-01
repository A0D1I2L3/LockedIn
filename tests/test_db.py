from __future__ import annotations

from app.db import Database


def _mk(mid: str, *, stage="application", company="Acme", date_ts=0, needs_action=0,
        subject="subj", snippet="", reason="") -> dict:
    return {
        "id": mid,
        "thread_id": f"t-{mid}",
        "subject": subject,
        "from_name": "",
        "from_email": f"x@{company.lower().replace(' ', '')}.com",
        "from_domain": f"{company.lower().replace(' ', '')}.com",
        "date_ts": date_ts,
        "snippet": snippet,
        "labels": [],
        "stage": stage,
        "company": company,
        "role": "",
        "needs_action": needs_action,
        "action_reason": reason,
    }


def test_upsert_and_counts(tmp_path):
    db = Database(tmp_path / "t.db")
    assert db.upsert_message(_mk("a", stage="application")) is True
    assert db.upsert_message(_mk("b", stage="interview")) is True
    assert db.upsert_message(_mk("c", stage="offer")) is True
    # duplicate id -> update, not insert
    assert db.upsert_message(_mk("a", stage="offer")) is False

    counts = db.stage_counts()
    assert counts["application"] == 0
    assert counts["offer"] == 2
    assert counts["total"] == 3


def test_filters_and_search(tmp_path):
    db = Database(tmp_path / "t.db")
    db.upsert_message(_mk("1", stage="interview", company="Acme", subject="Phone screen"))
    db.upsert_message(_mk("2", stage="rejection", company="Beta", subject="Update"))

    assert [m["id"] for m in db.get_messages(stage="interview")] == ["1"]
    assert [m["id"] for m in db.get_messages(company="Beta")] == ["2"]
    assert [m["id"] for m in db.get_messages(search="phone")] == ["1"]


def test_override_and_followups(tmp_path):
    db = Database(tmp_path / "t.db")
    db.upsert_message(_mk("1", stage="application", needs_action=1, reason="please respond"))

    db.set_stage_override("1", "interview")
    counts = db.stage_counts()
    assert counts["interview"] == 1
    assert counts["application"] == 0

    fups = db.followups()
    assert len(fups) == 1

    db.clear_action("1")
    assert db.followups() == []
    # sync preserves the dismissal
    db.upsert_message(_mk("1", stage="application", needs_action=1, reason="please respond"))
    assert db.followups() == []


def test_company_summary(tmp_path):
    db = Database(tmp_path / "t.db")
    db.upsert_message(_mk("1", stage="offer", company="Acme", date_ts=100))
    db.upsert_message(_mk("2", stage="application", company="Acme", date_ts=200))
    db.upsert_message(_mk("3", stage="interview", company="Beta", date_ts=300))

    summary = db.company_summary()
    by_name = {c["company"]: c for c in summary}
    assert by_name["Acme"]["message_count"] == 2
    assert by_name["Acme"]["latest_stage"] == "application"  # most recent
    assert by_name["Beta"]["latest_stage"] == "interview"


def test_meta(tmp_path):
    db = Database(tmp_path / "t.db")
    assert db.get_meta("last_sync") is None
    db.set_meta("last_sync", "2026-01-01")
    assert db.get_meta("last_sync") == "2026-01-01"