"""Application configuration.

Values are read from environment variables first, then from a local `.env`
file if present. Secrets (OAuth client, token, SQLite db) live under `data/`,
which is git-ignored.
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
    """Runtime settings for the internship dashboard."""

    def __init__(self) -> None:
        self.base_dir: Path = BASE_DIR
        self.data_dir: Path = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
        self.db_path: Path = Path(os.getenv("DB_PATH", self.data_dir / "dashboard.db"))
        self.token_path: Path = Path(
            os.getenv("TOKEN_FILE", self.data_dir / "token.json")
        )
        self.secret_store_path: Path = Path(
            os.getenv("SECRET_STORE_FILE", self.data_dir / "secret_store.json")
        )
        self.search_history_days: int = _env_int("SEARCH_HISTORY_DAYS", 180)
        self.followup_after_days: int = _env_int("FOLLOWUP_AFTER_DAYS", 2)
        self.host: str = os.getenv("HOST", "127.0.0.1")
        self.port: int = _env_int("PORT", 8000)

        # Public base URL of the site (used to build the OAuth redirect URI and
        # to advertise the "Sign in with Google" client). Set BASE_URL to the
        # public HTTPS origin when deploying.
        self.base_url: str = os.getenv("BASE_URL", f"http://{self.host}:{self.port}").rstrip("/")
        self.redirect_uri: str = f"{self.base_url}/oauth/callback"
        self.origin: str = self._origin(self.base_url)

        # OAuth client (Web application). May be entered in-app (encrypted) or
        # via env. Public client ID is also used for the GIS button on the page.
        self.google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        self.google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()

        # Encryption key for the in-app secret store. For a single user this can
        # default to a key derived from the local machine; for deployment, set
        # SECRET_KEY to a stable random value.
        self.secret_key: str = os.getenv("SECRET_KEY", "").strip()
        self.fernet_key_path: Path = Path(
            os.getenv("FERNET_KEY_FILE", self.data_dir / ".fernet_key")
        )

    @staticmethod
    def _origin(base_url: str) -> str:
        try:
            parsed = urlparse(base_url)
            return f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            return base_url

    def ensure_dirs(self) -> None:
        """Create the data directory (e.g. first run before OAuth)."""
        self.data_dir.mkdir(parents=True, exist_ok=True)


SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


settings = Settings()