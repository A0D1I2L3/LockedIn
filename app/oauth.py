"""Google OAuth 2.0 helpers for the "Sign in with Google" flow.

Implements the server-side pieces of the Authorization Code flow:

  * build URL to send the browser to Google's consent screen
  * handle the redirect back (exchange code for tokens)
  * build the Google Identity Services <button> config for the page
"""

from __future__ import annotations

from typing import Optional

from google.auth.transport import requests as google_requests
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from .config import SCOPES, settings
from .secret_store import secret_store

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def _credentials() -> dict:
    """Return {"client_id":..., "client_secret":..., "token":...}."""
    client_id = settings.google_client_id or secret_store.get("google_client_id")
    client_secret = settings.google_client_secret or secret_store.get("google_client_secret")
    if not client_id:
        raise LookupError(
            "Google OAuth is not configured. Add your Client ID in Settings."
        )
    return {
        "client_id": client_id,
        "client_secret": client_secret or "",
        "redirect_uri": settings.redirect_uri,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }


def _make_flow(state: Optional[str] = None) -> Flow:
    cfg = _credentials()
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uris": [settings.redirect_uri],
                "auth_uri": cfg["auth_uri"],
                "token_uri": cfg["token_uri"],
            }
        },
        scopes=SCOPES,
    )
    flow.redirect_uri = settings.redirect_uri
    # Disable PKCE: this is a confidential web client (we hold a client
    # secret), and disabling PKCE avoids needing to carry the code_verifier
    # across separate HTTP requests (login vs. callback).
    flow.autogenerate_code_verifier = False
    if state:
        flow.state = state
    return flow


def authorization_url(state: str) -> str:
    """URL to send the browser to for the consent screen."""
    flow = _make_flow(state)
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return url


def exchange_code(code: str, state: Optional[str] = None) -> dict:
    """Exchange the authorization code for tokens plus Google profile info."""
    flow = _make_flow(state)
    flow.fetch_token(code=code)
    # fetch_token returns a raw token mapping; use flow.credentials for a
    # full google.auth Credentials instance (access, refresh, expiry).
    creds = flow.credentials

    # Resolve the authenticated user via the userinfo endpoint so we can create
    # a per-user record keyed by Google's "sub".
    google_user_id = ""
    email = ""
    try:
        userinfo = (
            google_requests.AuthorizedSession(creds)
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .json()
        )
        google_user_id = userinfo.get("sub", "")
        email = userinfo.get("email", "")
    except Exception:
        # If the userinfo call failed (rare), we still return the tokens; the
        # user id will be empty and will be treated as a best-effort. Store
        # whatever we have.
        pass

    return {
        "google_user_id": google_user_id,
        "email": email,
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "expires_at": int(creds.expiry.timestamp() * 1000) if creds.expiry else None,
    }


def gis_client_id() -> Optional[str]:
    """The client ID to embed in the page's Google Identity Services button."""
    return settings.google_client_id or secret_store.get("google_client_id")


def is_configured() -> bool:
    try:
        _credentials()
        return True
    except LookupError:
        return False