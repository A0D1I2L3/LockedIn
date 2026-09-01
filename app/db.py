"""SQLite persistence layer.

The dashboard mirrors Gmail into a local SQLite database so the UI is fast,
offline-friendly, and easy to aggregate. Everything in this module is pure
Python/stdlib — no ORM.

This is a multi-user store:

Table `users`:
  id               INTEGER PK
  google_user_id   TEXT UNIQUE   (Google "sub" claim)
  email            TEXT
  created_at       TEXT

Table `oauth_tokens`:
  user_id       INTEGER -> users.id
  access_token  TEXT (encrypted)
  refresh_token TEXT (encrypted)
  expires_at    INTEGER (epoch ms)

Table `messages`:
  id            gmail message id (PK)
  user_id       owner (INTEGER -> users.id) — PK is (user_id, id)
  thread_id     gmail thread id
  subject, sender headers
  sender_email, sender_domain
  company, role   extracted metadata
  date_ts         epoch ms
  snippet, labels
  stage           classified pipeline stage
  needs_action    bool flag for follow-ups
  action_reason   why it needs action
  stage_override  manual user override of `stage`
  note            free-text user note

Table `meta`:
  key / value  (global app key/value)
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    google_user_id TEXT UNIQUE NOT NULL,
    email          TEXT,
    created_at     TEXT
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id),
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    thread_id     TEXT,
    subject       TEXT,
    from_name     TEXT,
    from_email    TEXT,
    from_domain   TEXT,
    date_ts       INTEGER,
    snippet       TEXT,
    labels        TEXT,
    stage         TEXT DEFAULT 'other',
    company       TEXT DEFAULT '',
    role          TEXT DEFAULT '',
    needs_action  INTEGER DEFAULT 0,
    action_reason TEXT DEFAULT '',
    stage_override TEXT,
    note          TEXT DEFAULT '',
    action_dismissed INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_messages_stage ON messages(stage);
CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date_ts);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


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

    # ------------------------------------------------------------------ meta

    def get_meta(self, key: str) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM meta WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    # -------------------------------------------------------------- users

    def get_or_create_user(self, google_user_id: str, email: str) -> int:
        """Return the user id for a google_user_id, creating the user row if
        needed. Returns the persistent user id."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id FROM users WHERE google_user_id = ?", (google_user_id,)
            ).fetchone()
            if row:
                if email:
                    conn.execute(
                        "UPDATE users SET email = ? WHERE id = ?", (email, row["id"])
                    )
                return row["id"]
            cur = conn.execute(
                "INSERT INTO users(google_user_id, email, created_at) VALUES (?, ?, ?)",
                (google_user_id, email, _now_iso()),
            )
            return cur.lastrowid

    def get_user(self, user_id: int) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        return dict(row) if row else None

    def all_user_ids(self) -> list[int]:
        with self._conn() as conn:
            rows = conn.execute("SELECT id FROM users").fetchall()
        return [r["id"] for r in rows]

    def delete_user(self, user_id: int) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM oauth_tokens WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM messages WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    # ---------------------------------------------------------- oauth tokens

    def save_oauth_token(
        self,
        user_id: int,
        access_token: str,
        refresh_token: Optional[str],
        expires_at: Optional[int],
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO oauth_tokens(user_id, access_token, refresh_token, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    access_token = excluded.access_token,
                    refresh_token = excluded.refresh_token,
                    expires_at = excluded.expires_at
                """,
                (user_id, access_token, refresh_token, expires_at),
            )

    def get_oauth_token(self, user_id: int) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM oauth_tokens WHERE user_id = ?", (user_id,)
            ).fetchone()
        return dict(row) if row else None

    def delete_oauth_token(self, user_id: int) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM oauth_tokens WHERE user_id = ?", (user_id,))

    # --------------------------------------------------------------- messages

    def upsert_message(self, user_id: int, msg: dict) -> bool:
        """Insert or update a message. Returns True if newly inserted."""
        existing = self.get_message(user_id, msg["id"])
        msg["labels"] = ",".join(msg.get("labels") or [])
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO messages (
                    id, user_id, thread_id, subject, from_name, from_email,
                    from_domain, date_ts, snippet, labels, stage, company, role,
                    needs_action, action_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, id) DO UPDATE SET
                    subject=excluded.subject,
                    from_name=excluded.from_name,
                    from_email=excluded.from_email,
                    from_domain=excluded.from_domain,
                    date_ts=excluded.date_ts,
                    snippet=excluded.snippet,
                    labels=excluded.labels,
                    stage=CASE WHEN stage_override IS NOT NULL
                               THEN stage ELSE excluded.stage END,
                    company=excluded.company,
                    role=CASE WHEN stage_override IS NOT NULL
                              THEN role ELSE excluded.role END,
                    needs_action=CASE
                        WHEN action_dismissed = 1 THEN 0
                        ELSE excluded.needs_action
                    END,
                    action_reason=excluded.action_reason
                """,
                (
                    msg["id"],
                    user_id,
                    msg["thread_id"],
                    msg["subject"],
                    msg.get("from_name", ""),
                    msg.get("from_email", ""),
                    msg.get("from_domain", ""),
                    msg["date_ts"],
                    msg.get("snippet", ""),
                    msg.get("labels", ""),
                    msg.get("stage", "other"),
                    msg.get("company", ""),
                    msg.get("role", ""),
                    1 if msg.get("needs_action") else 0,
                    msg.get("action_reason", ""),
                ),
            )
        return existing is None

    def get_message(self, user_id: int, message_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM messages WHERE user_id = ? AND id = ?",
                (user_id, message_id),
            ).fetchone()
        return dict(row) if row else None

    def get_messages(
        self,
        user_id: int,
        stage: Optional[str] = None,
        company: Optional[str] = None,
        search: Optional[str] = None,
        needs_action: Optional[bool] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        clauses: list[str] = ["user_id = ?"]
        params: list = [user_id]
        if stage and stage != "all":
            clauses.append("COALESCE(stage_override, stage) = ?")
            params.append(stage)
        if company and company != "all":
            clauses.append("company = ?")
            params.append(company)
        if needs_action is not None:
            clauses.append("needs_action = ?")
            params.append(1 if needs_action else 0)
        if search:
            like = f"%{search}%"
            clauses.append(
                "(subject LIKE ? OR from_name LIKE ? OR company LIKE ? "
                "OR snippet LIKE ?)"
            )
            params.extend([like, like, like, like])
        where = " WHERE " + " AND ".join(clauses)
        params.append(limit)
        params.append(offset)
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM messages"
                + where
                + " ORDER BY date_ts DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
        return [dict(r) for r in rows]

    def effective_stage(self, row: dict) -> str:
        return row.get("stage_override") or row.get("stage") or "other"

    def stage_counts(self, user_id: int) -> dict:
        """Counts per effective stage, plus totals, for one user."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT COALESCE(stage_override, stage) AS s, COUNT(*) AS n "
                "FROM messages WHERE user_id = ? GROUP BY s",
                (user_id,),
            ).fetchall()
        counts = {r["s"]: r["n"] for r in rows}
        return {
            **{s: counts.get(s, 0) for s in ["application", "interview", "offer", "rejection", "other"]},
            "total": sum(counts.values()),
        }

    def company_summary(self, user_id: int) -> list[dict]:
        """Per-company aggregation ordered by most recent activity.

        Returns a list of dicts: company, latest_stage, message_count,
        last_contact_ts, roles_seen.
        """
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT company,
                       COUNT(*)                                    AS message_count,
                       MAX(date_ts)                                AS last_contact_ts,
                       COALESCE(stage_override, stage)             AS latest_stage
                FROM messages
                WHERE user_id = ? AND company != ''
                GROUP BY company
                HAVING COUNT(*) > 0
                ORDER BY last_contact_ts DESC
                """,
                (user_id,),
            ).fetchall()
            role_rows = conn.execute(
                """
                SELECT company, GROUP_CONCAT(DISTINCT role) AS roles
                FROM messages WHERE user_id = ? AND role != '' GROUP BY company
                """,
                (user_id,),
            ).fetchall()
        roles_by_company = {r["company"]: r["roles"] for r in role_rows}
        out = []
        for r in rows:
            out.append(
                {
                    "company": r["company"],
                    "latest_stage": r["latest_stage"],
                    "message_count": r["message_count"],
                    "last_contact_ts": r["last_contact_ts"],
                    "roles": roles_by_company.get(r["company"], "").split(","),
                }
            )
        return out

    def followups(self, user_id: int, older_than_days: int = 2, limit: int = 100) -> list[dict]:
        """Messages flagged as needing action, newest first."""
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM messages
                WHERE user_id = ? AND needs_action = 1
                ORDER BY date_ts DESC LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def set_stage_override(self, user_id: int, message_id: str, stage: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE messages SET stage_override = ? WHERE user_id = ? AND id = ?",
                (stage, user_id, message_id),
            )

    def set_note(self, user_id: int, message_id: str, note: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE messages SET note = ? WHERE user_id = ? AND id = ?",
                (note, user_id, message_id),
            )

    def clear_action(self, user_id: int, message_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE messages SET needs_action = 0, action_dismissed = 1 "
                "WHERE user_id = ? AND id = ?",
                (user_id, message_id),
            )

    def rearm_action(self, user_id: int, message_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE messages SET action_dismissed = 0 WHERE user_id = ? AND id = ?",
                (user_id, message_id),
            )

    def clear_all_actions(self, user_id: int) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE messages SET needs_action = 0 WHERE user_id = ?", (user_id,)
            )
        return cur.rowcount


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")