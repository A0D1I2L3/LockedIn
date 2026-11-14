from __future__ import annotations

from app.db import Database
from app.models import REMINDER_CHECK_BACK, STAGE_APPLIED, STAGE_INTERVIEW, STAGE_OFFER


def _user(db: Database, google_id: str = "u1", email: str = "a@example.com") -> int:
    return db.get_or_create_user(google_id, email)


def _app(db: Database, uid: int, company: str = "Acme", **fields) -> dict:
    data = {
        "company": company,
        "role": "Software Intern",
        "stage": STAGE_APPLIED,
        "check_back_at": 1_800_000_000_000,
        "next_action": "Wait for a response",
    }
    data.update(fields)
    return db.create_application(uid, data)


def test_user_roundtrip_and_isolation(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    assert db.get_user(uid)["email"] == "a@example.com"
    assert _user(db, "u1", "new@example.com") == uid
    assert db.get_user(uid)["email"] == "new@example.com"

    other = _user(db, "u2", "b@example.com")
    _app(db, uid, "Acme")
    assert len(db.list_applications(uid)) == 1
    assert db.list_applications(other) == []


def test_application_crud_and_filters(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    first = _app(db, uid, "Acme", stage=STAGE_INTERVIEW)
    second = _app(db, uid, "Beta", stage=STAGE_OFFER)

    assert [row["id"] for row in db.list_applications(uid, stage=STAGE_INTERVIEW)] == [first["id"]]
    assert [row["id"] for row in db.list_applications(uid, q="beta")] == [second["id"]]

    updated = db.update_application(uid, first["id"], {"company": "Acme Corp", "notes": "hello"})
    assert updated["company"] == "Acme Corp"
    assert updated["notes"] == "hello"

    counts = db.stats(uid)["by_stage"]
    assert counts[STAGE_INTERVIEW] == 1
    assert counts[STAGE_OFFER] == 1

    db.delete_application(uid, first["id"])
    assert db.get_application(uid, first["id"]) is None


def test_stats_due_and_upcoming(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    _app(db, uid, "Due", check_back_at=100)
    _app(db, uid, "Later", check_back_at=9_999_999_999_999)
    stats = db.stats(uid, now=1_000)
    assert stats["total"] == 2
    assert stats["active"] == 2
    assert stats["due"] == 1
    assert stats["upcoming"] == 1


def test_reminders_and_events(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    app_row = _app(db, uid)
    reminder = db.add_reminder(
        uid,
        app_row["id"],
        {"kind": REMINDER_CHECK_BACK, "due_at": 123, "title": "Check in"},
    )
    assert reminder["payload"] == {}
    assert len(db.list_reminders(uid)) == 1

    db.complete_reminder(uid, reminder["id"])
    assert db.list_reminders(uid) == []
    assert db.get_reminder(uid, reminder["id"])["status"] == "done"

    event = db.add_event(uid, app_row["id"], "created", {"stage": STAGE_APPLIED})
    assert event["data"]["stage"] == STAGE_APPLIED
    assert db.list_events(uid, app_row["id"])[0]["type"] == "created"

    db.delete_application(uid, app_row["id"])
    assert db.list_events(uid, app_row["id"]) == []


def test_user_settings_merge(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    assert db.get_user_settings(uid) == {}
    merged = db.set_user_settings(uid, {"parser_mode": "rules"})
    assert merged["parser_mode"] == "rules"
    merged = db.set_user_settings(uid, {"default_follow_up_days": 10})
    assert merged["parser_mode"] == "rules"
    assert merged["default_follow_up_days"] == 10


def test_emails_are_scoped_to_application(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    app_row = _app(db, uid)
    email = db.add_email(
        uid,
        app_row["id"],
        {
            "subject": "Update",
            "raw_text": "hello",
            "parsed": {"stage": STAGE_APPLIED},
            "confidence": 0.8,
        },
    )
    assert email["parsed"]["stage"] == STAGE_APPLIED
    assert len(db.list_emails(uid, app_row["id"])) == 1
