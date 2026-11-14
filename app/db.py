"""SQLite persistence layer for applications, emails, reminders, and events.

Every query is scoped by `user_id`. There is no Gmail mirror and no ORM.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from .models import (
    ACTION_WAITING,
    REMINDER_CANCELLED,
    REMINDER_PENDING,
    STAGE_APPLIED,
    STAGES,
    STATUS_ACTIVE,
    json_load,
    serialize_email,
    serialize_event,
    serialize_reminder,
)
from .timeutil import now_ms

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    google_user_id TEXT UNIQUE NOT NULL,
    email          TEXT,
    created_at     TEXT
);

CREATE TABLE IF NOT EXISTS applications (
    id                TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    company           TEXT NOT NULL DEFAULT '',
    role              TEXT NOT NULL DEFAULT '',
    location          TEXT NOT NULL DEFAULT '',
    job_url           TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL DEFAULT '',
    stage             TEXT NOT NULL DEFAULT 'applied',
    status            TEXT NOT NULL DEFAULT 'active',
    action_state      TEXT NOT NULL DEFAULT 'waiting',
    next_action       TEXT NOT NULL DEFAULT '',
    next_action_at    INTEGER,
    check_back_at     INTEGER,
    check_back_source TEXT NOT NULL DEFAULT 'default',
    applied_at        INTEGER,
    last_contact_at   INTEGER,
    follow_up_count   INTEGER NOT NULL DEFAULT 0,
    notes             TEXT NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    closed_at         INTEGER
);

CREATE TABLE IF NOT EXISTS emails (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    application_id TEXT NOT NULL REFERENCES applications(id),
    subject        TEXT NOT NULL DEFAULT '',
    from_email     TEXT NOT NULL DEFAULT '',
    received_at    INTEGER,
    raw_text       TEXT NOT NULL DEFAULT '',
    parsed_json    TEXT NOT NULL DEFAULT '{}',
    confidence     REAL NOT NULL DEFAULT 0,
    parser_version TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    application_id TEXT NOT NULL REFERENCES applications(id),
    kind           TEXT NOT NULL,
    due_at         INTEGER NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending',
    payload_json   TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    completed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    application_id TEXT NOT NULL REFERENCES applications(id),
    type           TEXT NOT NULL,
    data_json      TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    data    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_check_back ON applications(check_back_at);
CREATE INDEX IF NOT EXISTS idx_emails_application ON emails(application_id);
CREATE INDEX IF NOT EXISTS idx_reminders_application ON reminders(application_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
CREATE INDEX IF NOT EXISTS idx_events_application ON events(application_id);
"""

_APPLICATION_FIELDS = {
    "company",
    "role",
    "location",
    "job_url",
    "source",
    "stage",
    "status",
    "action_state",
    "next_action",
    "next_action_at",
    "check_back_at",
    "check_back_source",
    "applied_at",
    "last_contact_at",
    "follow_up_count",
    "notes",
    "closed_at",
}


class Database:
    def __init__(self, db_path: Path | str) -> None:
        self.db_path = str(db_path)
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------ users

    def get_or_create_user(self, google_user_id: str, email: str) -> int:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id FROM users WHERE google_user_id = ?", (google_user_id,)
            ).fetchone()
            if row:
                if email:
                    conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, row["id"]))
                return int(row["id"])
            cur = conn.execute(
                "INSERT INTO users(google_user_id, email, created_at) VALUES (?, ?, ?)",
                (google_user_id, email, _now_iso()),
            )
            return int(cur.lastrowid)

    def get_user(self, user_id: int) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def all_user_ids(self) -> list[int]:
        with self._conn() as conn:
            rows = conn.execute("SELECT id FROM users").fetchall()
        return [int(r["id"]) for r in rows]

    def delete_user(self, user_id: int) -> None:
        with self._conn() as conn:
            for table in ("events", "reminders", "emails", "applications", "user_settings"):
                conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    # --------------------------------------------------------------- settings

    def get_user_settings(self, user_id: int) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT data FROM user_settings WHERE user_id = ?", (user_id,)
            ).fetchone()
        return json_load(row["data"], {}) if row else {}

    def set_user_settings(self, user_id: int, values: dict) -> dict:
        merged = {**self.get_user_settings(user_id), **values}
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO user_settings(user_id, data) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
                (user_id, json.dumps(merged)),
            )
        return merged

    # ----------------------------------------------------------- applications

    def create_application(self, user_id: int, data: dict) -> dict:
        app_id = data.get("id") or uuid.uuid4().hex
        ts = now_ms()
        applied_at = data.get("applied_at") or ts
        row = {
            "id": app_id,
            "user_id": user_id,
            "company": (data.get("company") or "").strip(),
            "role": (data.get("role") or "").strip(),
            "location": (data.get("location") or "").strip(),
            "job_url": (data.get("job_url") or "").strip(),
            "source": (data.get("source") or "").strip(),
            "stage": data.get("stage") or STAGE_APPLIED,
            "status": data.get("status") or STATUS_ACTIVE,
            "action_state": data.get("action_state") or ACTION_WAITING,
            "next_action": (data.get("next_action") or "").strip(),
            "next_action_at": data.get("next_action_at"),
            "check_back_at": data.get("check_back_at"),
            "check_back_source": data.get("check_back_source") or "default",
            "applied_at": applied_at,
            "last_contact_at": data.get("last_contact_at") or applied_at,
            "follow_up_count": int(data.get("follow_up_count") or 0),
            "notes": data.get("notes") or "",
            "created_at": ts,
            "updated_at": ts,
            "closed_at": data.get("closed_at"),
        }
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO applications (
                    id, user_id, company, role, location, job_url, source, stage,
                    status, action_state, next_action, next_action_at,
                    check_back_at, check_back_source, applied_at, last_contact_at,
                    follow_up_count, notes, created_at, updated_at, closed_at
                ) VALUES (
                    :id, :user_id, :company, :role, :location, :job_url, :source, :stage,
                    :status, :action_state, :next_action, :next_action_at,
                    :check_back_at, :check_back_source, :applied_at, :last_contact_at,
                    :follow_up_count, :notes, :created_at, :updated_at, :closed_at
                )
                """,
                row,
            )
        return self.get_application(user_id, app_id) or row

    def get_application(self, user_id: int, app_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM applications WHERE user_id = ? AND id = ?",
                (user_id, app_id),
            ).fetchone()
        return dict(row) if row else None

    def list_applications(
        self,
        user_id: int,
        *,
        stage: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
        due_before: Optional[int] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> list[dict]:
        clauses = ["user_id = ?"]
        params: list = [user_id]
        if stage and stage != "all":
            clauses.append("stage = ?")
            params.append(stage)
        if status and status != "all":
            clauses.append("status = ?")
            params.append(status)
        if due_before is not None:
            clauses.append("status = 'active' AND check_back_at IS NOT NULL AND check_back_at <= ?")
            params.append(due_before)
        if q:
            like = f"%{q}%"
            clauses.append("(company LIKE ? OR role LIKE ? OR notes LIKE ? OR next_action LIKE ?)")
            params.extend([like, like, like, like])
        params.extend([limit, offset])
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM applications WHERE "
                + " AND ".join(clauses)
                + " ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
        return [dict(r) for r in rows]

    def update_application(self, user_id: int, app_id: str, fields: dict) -> Optional[dict]:
        allowed = {k: v for k, v in fields.items() if k in _APPLICATION_FIELDS}
        if not allowed:
            return self.get_application(user_id, app_id)
        allowed["updated_at"] = now_ms()
        assignments = ", ".join(f"{key} = ?" for key in allowed)
        params = list(allowed.values()) + [user_id, app_id]
        with self._conn() as conn:
            conn.execute(
                f"UPDATE applications SET {assignments} WHERE user_id = ? AND id = ?",
                params,
            )
        return self.get_application(user_id, app_id)

    def delete_application(self, user_id: int, app_id: str) -> None:
        with self._conn() as conn:
            for table in ("events", "reminders", "emails"):
                conn.execute(
                    f"DELETE FROM {table} WHERE user_id = ? AND application_id = ?",
                    (user_id, app_id),
                )
            conn.execute(
                "DELETE FROM applications WHERE user_id = ? AND id = ?", (user_id, app_id)
            )

    def stats(self, user_id: int, now: Optional[int] = None) -> dict:
        now = now or now_ms()
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT stage, COUNT(*) AS n FROM applications WHERE user_id = ? GROUP BY stage",
                (user_id,),
            ).fetchall()
            active = conn.execute(
                "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'active'",
                (user_id,),
            ).fetchone()
            due = conn.execute(
                "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'active' "
                "AND check_back_at IS NOT NULL AND check_back_at <= ?",
                (user_id, now),
            ).fetchone()
            upcoming = conn.execute(
                "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'active' "
                "AND check_back_at IS NOT NULL AND check_back_at > ?",
                (user_id, now),
            ).fetchone()
        counts = {r["stage"]: r["n"] for r in rows}
        by_stage = {stage: counts.get(stage, 0) for stage in STAGES}
        return {
            "by_stage": by_stage,
            "total": sum(counts.values()),
            "active": int(active["n"]),
            "due": int(due["n"]),
            "upcoming": int(upcoming["n"]),
        }

    # ---------------------------------------------------------------- emails

    def add_email(self, user_id: int, app_id: str, data: dict) -> dict:
        email_id = data.get("id") or uuid.uuid4().hex
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO emails (
                    id, user_id, application_id, subject, from_email, received_at,
                    raw_text, parsed_json, confidence, parser_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    email_id,
                    user_id,
                    app_id,
                    data.get("subject") or "",
                    data.get("from_email") or "",
                    data.get("received_at"),
                    data.get("raw_text") or "",
                    json.dumps(data.get("parsed") or {}),
                    float(data.get("confidence") or 0),
                    data.get("parser_version") or "",
                    now_ms(),
                ),
            )
        return self.get_email(user_id, email_id) or {}

    def get_email(self, user_id: int, email_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM emails WHERE user_id = ? AND id = ?", (user_id, email_id)
            ).fetchone()
        return serialize_email(dict(row)) if row else None

    def list_emails(self, user_id: int, app_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM emails WHERE user_id = ? AND application_id = ? "
                "ORDER BY created_at DESC",
                (user_id, app_id),
            ).fetchall()
        return [serialize_email(dict(r)) for r in rows]

    # ------------------------------------------------------------- reminders

    def add_reminder(self, user_id: int, app_id: str, data: dict) -> dict:
        reminder_id = data.get("id") or uuid.uuid4().hex
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO reminders (
                    id, user_id, application_id, kind, due_at, title, body,
                    status, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    reminder_id,
                    user_id,
                    app_id,
                    data["kind"],
                    int(data["due_at"]),
                    data.get("title") or "",
                    data.get("body") or "",
                    data.get("status") or REMINDER_PENDING,
                    json.dumps(data.get("payload") or {}),
                    now_ms(),
                ),
            )
        return self.get_reminder(user_id, reminder_id) or {}

    def get_reminder(self, user_id: int, reminder_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM reminders WHERE user_id = ? AND id = ?",
                (user_id, reminder_id),
            ).fetchone()
        return serialize_reminder(dict(row)) if row else None

    def list_reminders(
        self,
        user_id: int,
        *,
        app_id: Optional[str] = None,
        pending_only: bool = True,
        due_before: Optional[int] = None,
        limit: int = 500,
    ) -> list[dict]:
        clauses = ["user_id = ?"]
        params: list = [user_id]
        if app_id:
            clauses.append("application_id = ?")
            params.append(app_id)
        if pending_only:
            clauses.append("status = 'pending'")
        if due_before is not None:
            clauses.append("due_at <= ?")
            params.append(due_before)
        params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM reminders WHERE "
                + " AND ".join(clauses)
                + " ORDER BY due_at ASC LIMIT ?",
                params,
            ).fetchall()
        return [serialize_reminder(dict(r)) for r in rows]

    def complete_reminder(self, user_id: int, reminder_id: str, status: str = "done") -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE reminders SET status = ?, completed_at = ? "
                "WHERE user_id = ? AND id = ?",
                (status, now_ms(), user_id, reminder_id),
            )

    def cancel_reminders(
        self, user_id: int, app_id: str, kind: Optional[str] = None
    ) -> int:
        clauses = ["user_id = ?", "application_id = ?", "status = 'pending'"]
        params: list = [user_id, app_id]
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE reminders SET status = '{REMINDER_CANCELLED}', completed_at = ? "
                f"WHERE {' AND '.join(clauses)}",
                [now_ms()] + params,
            )
        return cur.rowcount

    # ---------------------------------------------------------------- events

    def add_event(self, user_id: int, app_id: str, event_type: str, data: dict | None = None) -> dict:
        event_id = uuid.uuid4().hex
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO events (id, user_id, application_id, type, data_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (event_id, user_id, app_id, event_type, json.dumps(data or {}), now_ms()),
            )
        return {
            "id": event_id,
            "user_id": user_id,
            "application_id": app_id,
            "type": event_type,
            "data": data or {},
            "created_at": now_ms(),
        }

    def list_events(self, user_id: int, app_id: str, limit: int = 100) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM events WHERE user_id = ? AND application_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                (user_id, app_id, limit),
            ).fetchall()
        return [serialize_event(dict(r)) for r in rows]


def _now_iso() -> str:
    from .timeutil import iso_now

    return iso_now()
