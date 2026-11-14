"""Application configuration.

Values are read from environment variables first, then from a local `.env`
file if present. User-specific preferences (LLM provider, timezone, follow-up
cadence) live in SQLite and are managed from the Settings dialog.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

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
    """Runtime settings for the internship tracker."""

    def __init__(self) -> None:
        self.base_dir: Path = BASE_DIR
        self.data_dir: Path = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
        self.db_path: Path = Path(os.getenv("DB_PATH", self.data_dir / "dashboard.db"))
        self.secret_store_path: Path = Path(
            os.getenv("SECRET_STORE_FILE", self.data_dir / "secret_store.json")
        )
        self.host: str = os.getenv("HOST", "127.0.0.1")
        self.port: int = _env_int("PORT", 8000)

        # Public base URL, used to build the Google OAuth redirect URI.
        self.base_url: str = os.getenv("BASE_URL", f"http://{self.host}:{self.port}").rstrip("/")
        self.redirect_uri: str = f"{self.base_url}/oauth/callback"
        self.origin: str = self._origin(self.base_url)

        # Google OAuth client. It is used for identity only; the app never asks
        # for Gmail scopes. Values may also be entered in Settings and are then
        # stored encrypted.
        self.google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        self.google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()

        # Stable encryption key for sessions and the encrypted secret store.
        self.secret_key: str = os.getenv("SECRET_KEY", "").strip()
        self.fernet_key_path: Path = Path(
            os.getenv("FERNET_KEY_FILE", self.data_dir / ".fernet_key")
        )

        # Parsing defaults. Per-user preferences can override these.
        self.default_follow_up_days: int = _env_int("DEFAULT_FOLLOW_UP_DAYS", 7)
        self.app_timezone: str = os.getenv("APP_TIMEZONE", "UTC")
        self.llm_provider: str = os.getenv("LLM_PROVIDER", "openai").strip().lower()
        self.llm_base_url: str = os.getenv("LLM_BASE_URL", "").strip()
        self.llm_model: str = os.getenv("LLM_MODEL", "").strip()
        self.llm_api_key: str = os.getenv("LLM_API_KEY", "").strip()
        self.llm_timeout_seconds: float = float(os.getenv("LLM_TIMEOUT_SECONDS", "20") or 20)

    @staticmethod
    def _origin(base_url: str) -> str:
        try:
            parsed = urlparse(base_url)
            return f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            return base_url

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)


SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


settings = Settings()
