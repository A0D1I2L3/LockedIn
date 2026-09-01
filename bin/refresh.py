"""Headless sync — for cron / systemd timers.

    python bin/refresh.py            # incremental
    python bin/refresh.py --full     # re-scan the last N days
    python bin/refresh.py --max 50   # limit how many messages to scan (debug)

This performs the same sync as the dashboard's "Refresh" button but without
serving a web UI, so you can schedule it:

    crontab -e
    # every morning at 8am:
    0 8 * * * cd /path/to/internship-dashboard && python bin/refresh.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.config import settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.gmail_client import GmailClient  # noqa: E402
from app.pipeline import sync  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Gmail into the dashboard DB.")
    parser.add_argument("--full", action="store_true", help="full re-scan from search window")
    parser.add_argument("--max", type=int, default=None, help="only scan N messages (debug)")
    args = parser.parse_args()

    settings.ensure_dirs()
    client = GmailClient()
    if not client.has_token():
        sys.exit("Not authenticated. Run `python bin/setup_oauth.py` first.")

    db = Database(settings.db_path)
    result = sync(client, db, full=args.full, max_messages=args.max)
    print(
        f"sync done (full={result.full}): "
        f"scanned {result.scanned}, saved {result.saved}, "
        f"updated {result.updated}, skipped {result.skipped}"
    )


if __name__ == "__main__":
    main()