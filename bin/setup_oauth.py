"""One-time OAuth setup: connect your Gmail account.

Run from the project root:

    python bin/setup_oauth.py

This opens your browser to the Google consent screen. After you approve, the
refresh+access token is stored in `data/token.json`. The dashboard server and
the headless `bin/refresh.py` script both reuse that token.

You need a `data/client_secret.json` first (see README, "Google Cloud setup").
"""

from __future__ import annotations

import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.config import SCOPES, settings  # noqa: E402


def main() -> None:
    settings.ensure_dirs()

    if not settings.client_secret_path.exists():
        sys.exit(
            f"Missing {settings.client_secret_path}\n"
            "Create your OAuth client ID (Desktop app) in the Google Cloud "
            "Console and save the downloaded JSON as data/client_secret.json "
            "(see README → Google Cloud setup)."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(settings.client_secret_path), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent")

    settings.token_path.write_text(creds.to_json())
    print(f"\nSaved token to {settings.token_path}")
    print("You're authenticated. Start the dashboard:\n    python bin/serve.py")


if __name__ == "__main__":
    main()