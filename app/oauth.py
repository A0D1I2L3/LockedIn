"""Google OAuth 2.0 identity helpers.

This is a plain "Sign in with Google" flow. The requested scopes are identity
scopes only (openid, email, profile); there is no Gmail access and no token
storage beyond the browser session cookie.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Optional

from google_auth_oauthlib.flow import Flow

from .config import SCOPES, settings
from .secret_store import secret_store

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def _credentials() -> dict:
    client_id = settings.google_client_id or secret_store.get("google_client_id")
    client_secret = settings.google_client_secret or secret_store.get("google_client_secret")
    if not client_id:
        raise LookupError("Google OAuth is not configured. Add your Client ID in Settings.")
    return {"client_id": client_id, "client_secret": client_secret or ""}


def _make_flow(state: Optional[str] = None) -> Flow:
    cfg = _credentials()
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uris": [settings.redirect_uri],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=SCOPES,
    )
    flow.redirect_uri = settings.redirect_uri
    flow.autogenerate_code_verifier = False
    if state:
        flow.state = state
    return flow


def authorization_url(state: str) -> str:
    flow = _make_flow(state)
    url, _ = flow.authorization_url(prompt="select_account", include_granted_scopes="true")
    return url


def _userinfo(access_token: str) -> dict:
    req = urllib.request.Request(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def exchange_code(code: str, state: Optional[str] = None) -> dict:
    """Exchange an authorization code for the user's Google identity."""
    flow = _make_flow(state)
    flow.fetch_token(code=code)
    creds = flow.credentials
    info = _userinfo(creds.token) if creds.token else {}
    return {
        "google_user_id": info.get("sub", ""),
        "email": info.get("email", ""),
    }


def gis_client_id() -> Optional[str]:
    return settings.google_client_id or secret_store.get("google_client_id")


def is_configured() -> bool:
    try:
        _credentials()
        return True
    except LookupError:
        return False
