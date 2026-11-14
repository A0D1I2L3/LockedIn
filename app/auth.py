"""Session cookies and identity helpers.

Google sign-in is used for identity only. The app never requests Gmail scopes
and never stores Google access or refresh tokens.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from .config import settings
from .secret_store import fernet_key_bytes

SESSION_COOKIE = "lockedin_session"


def _cookie_key() -> bytes:
    if settings.secret_key:
        return hashlib.sha256(settings.secret_key.encode()).digest()
    return fernet_key_bytes()


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
