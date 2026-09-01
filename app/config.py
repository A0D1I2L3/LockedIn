"""Application configuration.

Values are read from environment variables first, then from a local `.env`
file if present. Secrets (OAuth client, token, SQLite db) live under `data/`,
which is git-ignored.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw is not None else default
    except ValueError:
        return default


class Settings:
    """Runtime settings for the internship dashboard."""

    def __init__(self) -> None:
        self.base_dir: Path = BASE_DIR
        self.data_dir: Path = BASE_DIR / "data"
        self.db_path: Path = Path(os.getenv("DB_PATH", self.data_dir / "dashboard.db"))
        self.client_secret_path: Path = Path(
            os.getenv("CLIENT_SECRET_FILE", self.data_dir / "client_secret.json")
        )
        self.token_path: Path = Path(
            os.getenv("TOKEN_FILE", self.data_dir / "token.json")
        )
        self.search_history_days: int = _env_int("SEARCH_HISTORY_DAYS", 180)
        self.followup_after_days: int = _env_int("FOLLOWUP_AFTER_DAYS", 2)
        self.host: str = os.getenv("HOST", "127.0.0.1")
        self.port: int = _env_int("PORT", 8000)

    def ensure_dirs(self) -> None:
        """Create the data directory (e.g. first run before OAuth)."""
        self.data_dir.mkdir(parents=True, exist_ok=True)


SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]


settings = Settings()