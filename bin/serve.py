"""Start the dashboard server.

    python bin/serve.py

For Render: the platform sets PORT and expects the app to bind 0.0.0.0.
If PORT is set in the environment we bind to 0.0.0.0:PANEL and honour BASE_URL
for the OAuth redirect URI; otherwise we bind localhost:8000 by default.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.config import settings  # noqa: E402


def main() -> None:
    settings.ensure_dirs()
    port = int(os.environ.get("PORT", settings.port))
    host = os.environ.get("HOST", "0.0.0.0" if os.environ.get("PORT") else settings.host)
    uvicorn.run("app.api:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()