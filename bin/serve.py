"""Start the local dashboard server.

    python bin/serve.py
    open http://127.0.0.1:8000
"""

from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.config import settings  # noqa: E402


def main() -> None:
    settings.ensure_dirs()
    uvicorn.run("app.api:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()