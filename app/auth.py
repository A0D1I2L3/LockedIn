"""Session and per-user token management.

Because LockedIn is a public web app, we cannot (and should not) keep a single
global Gmail token. Instead each authenticated user has a row in `users` and an
encrypted row in `oauth_tokens`.

This module owns:
  * the browser session (signed cookie holding a nonce keyed to the user),
  * encrypting access/refresh tokens at rest (using the same Fernet key as the
    secret store), and
  * turning a request into the current user id, or None.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from .config import settings
from .db import Database
from .secret_store import _fernet_from_settings, fernet_key_bytes

SESSION_COOKIE = "lockedin_session"


def _cookie_key() -> bytes:
    # A stable HMAC key for signing session cookies. Uses SECRET_KEY when set,
    # otherwise the shared encryption key bytes (git-ignored, persistent).
    if settings.secret_key:
        return hashlib.sha256(settings.secret_key.encode()).digest()
    return fernet_key_bytes()


# ------------------------------------------------------------------ sessions

def create_session(user_id: int) -> str:
    """Produce a signed session token for a user id."""
    nonce = secrets.token_urlsafe(16)
    payload = f"{user_id}.{nonce}"
    sig = hmac.new(_cookie_key(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def validate_session(token: Optional[str]) -> Optional[int]:
    """Validate a signed session token; return user id or None."""
    if not token:
        return None
    try:
        payload, sig = token.rsplit(".", 1)
        expected = hmac.new(_cookie_key(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        return int(payload.split(".", 1)[0])
    except (ValueError, AttributeError):
        return None


# ------------------------------------------------------- token encryption

def _encrypt(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return _fernet_from_settings().encrypt(value.encode()).decode()


def _decrypt(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    try:
        return _fernet_from_settings().decrypt(value.encode()).decode()
    except Exception:
        return None


def store_tokens(db: Database, user_id: int, access: str, refresh: Optional[str], expires_at: Optional[int]) -> None:
    db.save_oauth_token(
        user_id,
        _encrypt(access),
        _encrypt(refresh),
        expires_at,
    )


def load_token_dict(db: Database, user_id: int) -> Optional[dict]:
    """Return a token dict for GmailClient, or None if the user has none."""
    row = db.get_oauth_token(user_id)
    if not row:
        return None
    return {
        "access_token": _decrypt(row["access_token"]),
        "refresh_token": _decrypt(row["refresh_token"]),
        "expires_at": row.get("expires_at"),
    }


def delete_tokens(db: Database, user_id: int) -> None:
    db.delete_oauth_token(user_id)