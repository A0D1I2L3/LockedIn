"""Gmail API client for per-user, token-based sync.

The OAuth exchange stores each user's tokens in the database (see db.auth).
This client builds google credentials from a token dict
{access_token, refresh_token} plus the app's OAuth client info, and uses them
to talk to the Gmail API.
"""

from __future__ import annotations

import base64
import re
from typing import Iterator, Optional

from google.auth.exceptions import GoogleAuthError, RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .config import SCOPES
from .models import EmailMessage


class GmailError(Exception):
    pass


def _from_header(value: str) -> tuple[str, str]:
    from email.utils import parseaddr

    name, addr = parseaddr((value or "").encode("ascii", "replace").decode("ascii"))
    if not name and "@" in (addr or ""):
        name = addr.split("@")[0].replace(".", " ").title()
    return name, addr


class GmailClient:
    def __init__(
        self,
        access_token: str,
        refresh_token: Optional[str],
        client_id: str,
        client_secret: str,
        expires_at: Optional[int] = None,
    ) -> None:
        self._creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
        )
        if expires_at:
            # Credentials.expiry is a datetime; set from epoch ms.
            from datetime import datetime, timezone

            self._creds.expiry = datetime.fromtimestamp(expires_at / 1000, tz=timezone.utc)
        self._service = None

    # ------------------------------------------------------------------ auth

    def user_email(self) -> str:
        return self.service().users().getProfile(userId="me").execute().get("emailAddress", "")

    def has_token(self) -> bool:
        return bool(self._creds and self._creds.token)

    def is_valid(self) -> bool:
        """True if credentials are usable, refreshing the token if needed."""
        try:
            if not self._creds.token:
                return False
            if self._creds.expired and self._creds.refresh_token:
                self._creds.refresh(Request())
            return True
        except (GoogleAuthError, RefreshError):
            return False

    def refreshed_token(self) -> Optional[dict]:
        """After is_valid(), returns updated token info (or None)."""
        return {
            "access_token": self._creds.token,
            "refresh_token": self._creds.refresh_token,
            "expires_at": int(self._creds.expiry.timestamp() * 1000) if self._creds.expiry else None,
        }

    def service(self):
        if self._service is None:
            creds = self._creds
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            self._service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        return self._service

    # ---------------------------------------------------------------- listing

    def list_message_ids(self, query: str) -> Iterator[str]:
        """Yield Gmail message ids matching a search query."""
        service = self.service()
        page_token = None
        while True:
            resp = (
                service.users()
                .messages()
                .list(userId="me", q=query, pageToken=page_token, maxResults=500)
                .execute()
            )
            for msg in resp.get("messages", []):
                yield msg["id"]
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    def fetch_metadata(self, message_id: str) -> EmailMessage:
        raw = (
            self.service()
            .users()
            .messages()
            .get(
                userId="me",
                id=message_id,
                format="metadata",
                metadataHeaders=["From", "Subject"],
            )
            .execute()
        )
        headers = {
            h["name"].lower(): h["value"]
            for h in raw.get("payload", {}).get("headers", [])
        }
        from_name, from_addr = _from_header(headers.get("from", ""))
        domain = (from_addr.rsplit("@", 1)[-1] if "@" in from_addr else "").lower()
        return EmailMessage(
            id=raw["id"],
            thread_id=raw.get("threadId", ""),
            subject=headers.get("subject", "(no subject)"),
            from_name=from_name,
            from_email=from_addr,
            from_domain=domain,
            date_ts=int(raw.get("internalDate") or 0),
            snippet=raw.get("snippet") or "",
            labels=raw.get("labelIds", []) or [],
        )

    # ------------------------------------------------------------------ body

    def fetch_body(self, message_id: str, max_chars: int = 6000) -> str:
        try:
            raw = (
                self.service()
                .users()
                .messages()
                .get(userId="me", id=message_id, format="full")
                .execute()
            )
        except HttpError as exc:
            return f"(Could not load body: {exc.resp.status})"
        body = self._extract_body(raw)
        body = re.sub(r"\s+", " ", body).strip()
        if len(body) > max_chars:
            body = body[:max_chars] + "…"
        return body

    @staticmethod
    def _extract_body(raw: dict) -> str:
        parts = []

        def walk(node: dict) -> None:
            mime = node.get("mimeType", "")
            if node.get("parts"):
                for p in node.get("parts", []):
                    walk(p)
            elif node.get("body", {}).get("data") and mime in ("text/plain", "text/html"):
                b64 = node["body"]["data"]
                decoded = base64.urlsafe_b64decode(b64).decode("utf-8", "replace")
                if mime == "text/html":
                    decoded = _strip_html(decoded)
                if decoded.strip():
                    parts.append(decoded)

        walk(raw.get("payload", {}))
        return "\n\n".join(parts).strip()


def _strip_html(html_text: str) -> str:
    import html as html_lib

    html_text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html_text)
    html_text = re.sub(r"(?is)<br\s*/?>", "\n", html_text)
    html_text = re.sub(r"(?is)</(p|div|li|tr|h[1-6]|blockquote)>", "\n", html_text)
    html_text = re.sub(r"(?is)<[^>]+>", " ", html_text)
    return html_lib.unescape(html_text)