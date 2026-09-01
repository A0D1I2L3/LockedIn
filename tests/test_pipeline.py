from __future__ import annotations

from app.config import settings
from app.db import Database
from app.models import EmailMessage, STAGE_REJECTION
from app.pipeline import sync


class FakeClient:
    """Replaces GmailClient with canned messages."""

    def __init__(self, messages):
        self._messages = messages  # list of raw email kwargs

    def list_message_ids(self, query):
        for i, m in enumerate(self._messages):
            yield f"msg-{i}"

    def fetch_metadata(self, message_id):
        i = int(message_id.split("-")[1])
        m = self._messages[i]
        return EmailMessage(
            id=message_id,
            thread_id=m.get("thread", f"t{i}"),
            subject=m["subject"],
            from_name=m.get("from_name", ""),
            from_email=m["from_email"],
            from_domain=m["from_email"].rsplit("@", 1)[-1],
            date_ts=m["date_ts"],
            snippet=m.get("snippet", ""),
            labels=m.get("labels", []),
        )


def _user(db) -> int:
    return db.get_or_create_user("u-test", "tester@example.com")


def test_sync_pipes_messages(tmp_path):
    settings.data_dir.mkdir(parents=True, exist_ok=True)  # ensure safe default
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    client = FakeClient(
        [
            {
                "subject": "Your application for SWE Intern",
                "from_email": "careers@janestreet.com",
                "date_ts": 1_700_000_000_000,
            },
            {
                "subject": "Update on your candidacy — not moving forward",
                "from_email": "no-reply@beta.com",
                "date_ts": 1_700_000_000_100,
            },
        ]
    )

    result = sync(client, db, uid, max_messages=10)
    assert result.saved == 2

    messages = db.get_messages(uid)
    by_company = {m["company"]: m for m in messages}
    assert by_company["Jane Street"]["stage"] == "application"
    assert by_company["Beta"]["stage"] == STAGE_REJECTION

    # terminal stage should not be flagged
    assert by_company["Beta"]["needs_action"] == 0


def test_sync_flag_on_schedule_ask(tmp_path):
    db = Database(tmp_path / "t.db")
    uid = _user(db)
    client = FakeClient(
        [
            {
                "subject": "Receipt of your application",
                "from_email": "recruiter@acme.com",
                "thread": "same-thread",  # older message in the thread
                "date_ts": 1_700_000_000_000,
                "snippet": "Welcome",
            },
            {
                "subject": "Interview with Acme",
                "from_email": "recruiter@acme.com",
                "thread": "same-thread",  # newest message carries the ask
                "date_ts": 1_700_000_000_200,
                "snippet": "Please let us know your availability for the interview",
            },
        ]
    )
    result = sync(client, db, uid, max_messages=10)
    assert result.saved == 2

    messages = {m["id"]: m for m in db.get_messages(uid)}
    # Only the newest message in a thread may carry the flag.
    flagged = [m for m in messages.values() if m["needs_action"]]
    assert len(flagged) == 1
    assert flagged[0]["id"] == "msg-1"
    assert flagged[0]["action_reason"] != ""