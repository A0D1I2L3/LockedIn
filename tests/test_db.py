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


def _user(db, google_id="u1", email="a@example.com") -> int:
    return db.get_or_create_user(google_id, email)


def test_user_and_token_crud(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    assert db.get_user(uid)["email"] == "a@example.com"
    # Same google id -> same user.
    assert _user(db) == uid

    db.save_oauth_token(uid, "acc-enc", "ref-enc", 123456789)
    row = db.get_oauth_token(uid)
    assert row["access_token"] == "acc-enc"
    assert row["refresh_token"] == "ref-enc"


def test_upsert_and_counts(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    assert db.upsert_message(uid, _mk("a", stage="application")) is True
    assert db.upsert_message(uid, _mk("b", stage="interview")) is True
    assert db.upsert_message(uid, _mk("c", stage="offer")) is True
    # duplicate id -> update, not insert
    assert db.upsert_message(uid, _mk("a", stage="offer")) is False

    counts = db.stage_counts(uid)
    assert counts["application"] == 0
    assert counts["offer"] == 2
    assert counts["total"] == 3


def test_filters_and_search(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    db.upsert_message(uid, _mk("1", stage="interview", company="Acme", subject="Phone screen"))
    db.upsert_message(uid, _mk("2", stage="rejection", company="Beta", subject="Update"))

    assert [m["id"] for m in db.get_messages(uid, stage="interview")] == ["1"]
    assert [m["id"] for m in db.get_messages(uid, company="Beta")] == ["2"]
    assert [m["id"] for m in db.get_messages(uid, search="phone")] == ["1"]


def test_override_and_followups(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    db.upsert_message(uid, _mk("1", stage="application", needs_action=1, reason="please respond"))

    db.set_stage_override(uid, "1", "interview")
    counts = db.stage_counts(uid)
    assert counts["interview"] == 1
    assert counts["application"] == 0

    fups = db.followups(uid, older_than_days=0)
    assert len(fups) == 1

    db.clear_action(uid, "1")
    assert db.followups(uid, older_than_days=0) == []
    # sync preserves the dismissal
    db.upsert_message(uid, _mk("1", stage="application", needs_action=1, reason="please respond"))
    assert db.followups(uid, older_than_days=0) == []


def test_user_isolation(tmp_path):
    db = Database(tmp_path / "t.db")
    uid1 = _user(db, "g1", "one@example.com")
    uid2 = _user(db, "g2", "two@example.com")
    db.upsert_message(uid1, _mk("x", stage="offer", company="Acme"))
    assert len(db.get_messages(uid1)) == 1
    assert len(db.get_messages(uid2)) == 0


def test_company_summary(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    db.upsert_message(uid, _mk("1", stage="offer", company="Acme", date_ts=100))
    db.upsert_message(uid, _mk("2", stage="application", company="Acme", date_ts=200))
    db.upsert_message(uid, _mk("3", stage="interview", company="Beta", date_ts=300))

    summary = db.company_summary(uid)
    by_name = {c["company"]: c for c in summary}
    assert by_name["Acme"]["message_count"] == 2
    assert by_name["Acme"]["latest_stage"] == "application"  # most recent
    assert by_name["Beta"]["latest_stage"] == "interview"


def test_meta(tmp_path):
    db = Database(tmp_path / "t.db")
    assert db.get_meta("last_sync_1") is None
    db.set_meta("last_sync_1", "2026-01-01")
    assert db.get_meta("last_sync_1") == "2026-01-01"