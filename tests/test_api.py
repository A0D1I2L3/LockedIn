from __future__ import annotations

from fastapi.testclient import TestClient
from pytest import fixture

from app import auth
from app.api import create_app
from app.config import settings
from app.db import Database


@fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "db_path", tmp_path / "api.db")
    monkeypatch.setattr(settings, "secret_store_path", tmp_path / "secrets.json")
    monkeypatch.setattr(settings, "fernet_key_path", tmp_path / "fernet.key")
    db = Database(settings.db_path)
    uid = db.get_or_create_user("google-1", "intern@example.com")
    test_client = TestClient(create_app())
    test_client.cookies.set(auth.SESSION_COOKIE, auth.create_session(uid))
    test_client.uid = uid
    test_client.db = db
    return test_client


def test_requires_sign_in(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "db_path", tmp_path / "api.db")
    monkeypatch.setattr(settings, "secret_store_path", tmp_path / "secrets.json")
    monkeypatch.setattr(settings, "fernet_key_path", tmp_path / "fernet.key")
    anonymous = TestClient(create_app())
    assert anonymous.get("/api/applications").status_code == 401


def test_create_list_patch_and_close(client):
    created = client.post(
        "/api/applications",
        json={
            "company": "Acme",
            "role": "SWE Intern",
            "stage": "applied",
            "check_back_at": "2026-12-01",
            "next_action": "Wait for a response",
        },
    )
    assert created.status_code == 200
    app_id = created.json()["id"]
    assert created.json()["check_back_at"] > 0

    listed = client.get("/api/applications").json()
    assert listed["count"] == 1
    assert listed["applications"][0]["company"] == "Acme"

    updated = client.patch(f"/api/applications/{app_id}", json={"stage": "rejected"})
    body = updated.json()
    assert body["stage"] == "rejected"
    assert body["status"] == "closed"
    assert body["check_back_at"] is None
    assert client.get("/api/due").json()["count"] == 0

    assert client.delete(f"/api/applications/{app_id}").status_code == 200
    assert client.get(f"/api/applications/{app_id}").status_code == 404


def test_email_parse_and_apply(client):
    app_id = client.post(
        "/api/applications", json={"company": "Acme", "role": "SWE Intern"}
    ).json()["id"]

    preview = client.post(
        "/api/parse-email",
        json={
            "raw_text": "We'd like to invite you to an interview. "
            "Please share your availability by December 5."
        },
    )
    assert preview.status_code == 200
    assert preview.json()["stage"] == "interview"

    attached = client.post(
        f"/api/applications/{app_id}/emails",
        json={
            "raw_text": "We'd like to invite you to an interview. "
            "Please share your availability by December 5.",
            "apply": True,
        },
    )
    assert attached.status_code == 200
    body = attached.json()
    assert body["application"]["stage"] == "interview"
    assert body["application"]["action_state"] == "action_required"
    assert body["draft"]["company"] in {"", "Acme"}
    assert client.get(f"/api/applications/{app_id}/emails").json()["emails"]


def test_snooze_moves_due_date(client):
    app_id = client.post(
        "/api/applications",
        json={"company": "Acme", "role": "SWE Intern", "check_back_at": "2026-11-01"},
    ).json()["id"]
    before = client.get(f"/api/applications/{app_id}").json()["check_back_at"]
    snoozed = client.post(f"/api/applications/{app_id}/snooze", json={"days": 5})
    assert snoozed.status_code == 200
    after = snoozed.json()["check_back_at"]
    assert after > before


def test_ics_and_settings(client):
    app_id = client.post(
        "/api/applications", json={"company": "Acme", "role": "SWE Intern"}
    ).json()["id"]
    one = client.get(f"/api/applications/{app_id}/calendar.ics")
    assert one.status_code == 200
    assert one.headers["content-type"].startswith("text/calendar")
    assert "BEGIN:VCALENDAR" in one.text
    assert "Check in" in one.text

    feed = client.get("/api/calendar.ics")
    assert feed.status_code == 200
    assert "BEGIN:VCALENDAR" in feed.text

    saved = client.post(
        "/api/settings",
        json={"parser_mode": "rules", "default_follow_up_days": 9, "timezone": "UTC"},
    )
    assert saved.status_code == 200
    prefs = client.get("/api/settings").json()["preferences"]
    assert prefs["parser_mode"] == "rules"
    assert prefs["default_follow_up_days"] == 9

    switched = client.post("/api/settings", json={"llm_provider": "claude"})
    assert switched.status_code == 200
    prefs = client.get("/api/settings").json()["preferences"]
    assert prefs["llm_provider"] == "claude"
    assert prefs["llm_base_url"] == "https://api.anthropic.com/v1"
    assert prefs["llm_model"].startswith("claude-")
