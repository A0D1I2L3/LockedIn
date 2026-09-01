"""Thin wrapper around the Gmail API.

Handles credential loading/refresh from the token stored by `setup_oauth`,
plus the two operations the dashboard needs: listing message metadata and
fetching a full plain-text body.

Scope: readonly + modify (so the app can later mark things read, add labels,
etc. without a scope change).
"""

from __future__ import annotations

import base64
import re
from email.utils import parseaddr
from typing import Iterator

from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .config import SCOPES, settings
from .models import EmailMessage

# Body charset handling looks for these headers.
_TEXT_PLAIN = "text/plain"
_TEXT_HTML = "text/html"

_WHITESPACE = re.compile(r"\s+")


def _decode(body: bytes) -> str:
    try:
        return body.decode("utf-8", "replace")
    except Exception:
        return body.decode("latin-1", "replace")


def _from_header(value: str) -> tuple[str, str]:
    """Return (display_name, email_address) from a From header."""
    name, addr = parseaddr((value or "").encode("ascii", "replace").decode("ascii"))
    if not name and "@" in (addr or ""):
        name = addr.split("@")[0].replace(".", " ").title()
    return name, addr


class GmailClient:
    def __init__(self, token_path=None) -> None:
        self.token_path = token_path or settings.token_path
        self._service = None

    # ------------------------------------------------------------------ auth

    def has_token(self) -> bool:
        try:
            return self.load_credentials().valid
        except GoogleAuthError:
            return False

    def load_credentials(self) -> Credentials:
        if not self.token_path.exists():
            raise GoogleAuthError(
                f"No token at {self.token_path}. Run `python bin/setup_oauth.py` "
                "first to connect your Gmail account."
            )
        creds = Credentials.from_authorized_user_file(str(self.token_path), SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            self.token_path.write_text(creds.to_json())
        return creds

    # ---------------------------------------------------------------- service

    def service(self):
        if self._service is None:
            creds = self.load_credentials()
            self._service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        return self._service

    def user_email(self) -> str:
        profile = self.service().users().getProfile(userId="me").execute()
        return profile.get("emailAddress", "")

    # ---------------------------------------------------------------- listing

    def list_messages(self, query: str) -> Iterator[dict]:
        """Iterate over message *summary* dicts (`id` + `threadId`) matching
        a Gmail search query."""
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
                yield msg
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    def fetch_metadata(self, message_id: str) -> EmailMessage:
        """Fetch one message's metadata + snippet as an EmailMessage."""
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
        return self._to_email(raw)

    # ------------------------------------------------------------------ body

    def fetch_body(self, message_id: str, max_chars: int = 6000) -> str:
        """Return the plain-text body of a message (HTML stripped)."""
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
        return self._extract_body(raw, max_chars)

    # ------------------------------------------------------------- parsing

    @staticmethod
    def _to_email(raw: dict) -> EmailMessage:
        headers = {h["name"].lower(): h["value"] for h in raw.get("payload", {}).get("headers", [])}
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

    @staticmethod
    def _extract_body(raw: dict, max_chars: int) -> str:
        parts = []

        def walk(node: dict) -> None:
            mime = node.get("mimeType", "")
            if node.get("parts"):
                for p in node.get("parts", []):
                    walk(p)
            elif node.get("body", {}).get("data") and mime in (_TEXT_PLAIN, _TEXT_HTML):
                b64 = node["body"]["data"]
                decoded = _decode(base64.urlsafe_b64decode(b64))
                if mime == _TEXT_HTML:
                    decoded = _strip_html(decoded)
                if decoded.strip():
                    parts.append(decoded)

        walk(raw.get("payload", {}))
        body = "\n\n".join(parts).strip()
        body = _WHITESPACE.sub(" ", body)
        if len(body) > max_chars:
            body = body[:max_chars] + "…"
        return body


def _strip_html(html_text: str) -> str:
    import html as html_lib
    import re as _re

    # Remove scripts/styles, block-level tags -> newlines, inline tags -> spaces.
    html_text = _re.sub(r"(?is)<(script|style).*?</\1>", " ", html_text)
    html_text = _re.sub(r"(?is)<br\s*/?>", "\n", html_text)
    html_text = _re.sub(r"(?is)</(p|div|li|tr|h[1-6]|blockquote)>", "\n", html_text)
    html_text = _re.sub(r"(?is)<[^>]+>", " ", html_text)
    return html_lib.unescape(html_text)