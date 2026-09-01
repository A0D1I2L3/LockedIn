"""Headless sync — for cron / systemd timers.

Syncing is now per-user (tokens live in the DB, keyed by user). Pick which
user to sync with --email:

    python bin/refresh.py --email you@gmail.com            # incremental
    python bin/refresh.py --email you@gmail.com --full     # re-scan window
    python bin/refresh.py --email you@gmail.com --max 50   # debug limit

Schedule it:

    crontab -e
    0 8 * * * cd /path/internship-dashboard && .venv/bin/python bin/refresh.py --email you@gmail.com

The user must have connected their Gmail at least once in the UI (so their
tokens are stored).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app import auth  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.gmail_client import GmailClient  # noqa: E402
from app.pipeline import sync  # noqa: E402
from app.secret_store import secret_store  # noqa: E402


def _find_user_id(db: Database, email: str) -> int | None:
    for uid in db.all_user_ids():
        user = db.get_user(uid)
        if user and (user["email"] or "").lower() == email.lower():
            return uid
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Gmail for a user into the dashboard DB.")
    parser.add_argument("--email", required=True, help="the user's Gmail address")
    parser.add_argument("--full", action="store_true", help="full re-scan from search window")
    parser.add_argument("--max", type=int, default=None, help="only scan N messages (debug)")
    args = parser.parse_args()

    settings.ensure_dirs()
    db = Database(settings.db_path)

    user_id = _find_user_id(db, args.email)
    if user_id is None:
        sys.exit(f"No user found with email {args.email!r}. They must connect Gmail in the UI first.")

    token = auth.load_token_dict(db, user_id)
    if not token:
        sys.exit(f"User {args.email} has no stored Gmail tokens. Connect in the UI first.")

    client = GmailClient(
        token["access_token"],
        token["refresh_token"],
        settings.google_client_id or secret_store.get("google_client_id"),
        settings.google_client_secret or secret_store.get("google_client_secret"),
        expires_at=token.get("expires_at"),
    )

    result = sync(client, db, user_id, full=args.full, max_messages=args.max)
    print(
        f"sync done for {args.email} (full={result.full}): "
        f"scanned {result.scanned}, saved {result.saved}, "
        f"updated {result.updated}, skipped {result.skipped}"
    )


if __name__ == "__main__":
    main()