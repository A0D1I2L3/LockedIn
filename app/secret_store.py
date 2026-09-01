"""Encrypted storage for OAuth client credentials and the Gmail token.

Because this is a web app (not a local-only script), the Google client ID and
client secret the user pastes in Settings are sensitive and are stored
encrypted at rest. A per-install Fernet key is generated and saved under
`data/`; everything is git-ignored.

Two backends used in one place:
  * Client ID / Secret  -> encrypted JSON keyed by name
  * Gmail token         -> `creds.to_json()` written to data/token.json
    (still plaintext JSON here, matching google's docs; the refresh token is
    the sensitive part — we keep it in the git-ignored data dir).

For a truly public deployment you should point SECRET_KEY / FERNET_KEY_FILE at
something durable. Local dev just works with the generated key.
"""

from __future__ import annotations

import json
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


class SecretStore:
    def __init__(self, key: Optional[bytes] = None, path=None) -> None:
        self.path = path or settings.secret_store_path
        if key is not None:
            self._fernet = Fernet(key)
        else:
            self._fernet = Fernet(self._load_key())

    # ---------------------------------------------------------------- key

    def _load_key(self) -> bytes:
        if settings.secret_key:
            # Derive a 32-byte URL-safe key from SECRET_KEY (>= 32 bytes).
            import base64
            import hashlib

            digest = hashlib.sha256(settings.secret_key.encode()).digest()
            return base64.urlsafe_b64encode(digest)
        if settings.fernet_key_path.exists():
            return settings.fernet_key_path.read_bytes().strip()
        key = Fernet.generate_key()
        settings.ensure_dirs()
        settings.fernet_key_path.write_bytes(key + b"\n")
        return key

    # ------------------------------------------------------------ secrets

    def set(self, name: str, value: str) -> None:
        data = self._read_all()
        data[name] = self._fernet.encrypt(value.encode()).decode()
        self._write_all(data)

    def get(self, name: str) -> Optional[str]:
        data = self._read_all()
        token = data.get(name)
        if not token:
            return None
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken:
            return None

    def set_many(self, values: dict[str, str]) -> None:
        data = self._read_all()
        for name, value in values.items():
            if value:
                data[name] = self._fernet.encrypt(value.encode()).decode()
        self._write_all(data)

    def all_names(self) -> list[str]:
        return list(self._read_all().keys())

    def clear(self, name: str) -> None:
        data = self._read_all()
        data.pop(name, None)
        self._write_all(data)

    def _read_all(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text())
        except (ValueError, OSError):
            return {}

    def _write_all(self, data: dict) -> None:
        settings.ensure_dirs()
        self.path.write_text(json.dumps(data, indent=2))

    # ---------------------------------------------------------------- token

    def set_token(self, token_json: str) -> None:
        settings.ensure_dirs()
        settings.token_path.write_text(token_json)

    def get_token(self) -> Optional[str]:
        if settings.token_path.exists():
            return settings.token_path.read_text()
        return None

    def has_token(self) -> bool:
        return settings.token_path.exists()

    def clear_token(self) -> None:
        if settings.token_path.exists():
            settings.token_path.unlink()

    def clear_all(self) -> None:
        if settings.secret_store_path.exists():
            settings.secret_store_path.unlink()
        self.clear_token()


def _fernet_from_settings() -> Fernet:
    """A Fernet instance keyed deterministically from the app settings."""
    return Fernet(fernet_key_bytes())


def fernet_key_bytes() -> bytes:
    """Return (and lazily create) the shared encryption key bytes."""
    if settings.secret_key:
        import base64
        import hashlib

        digest = hashlib.sha256(settings.secret_key.encode()).digest()
        return base64.urlsafe_b64encode(digest)
    if settings.fernet_key_path.exists():
        return settings.fernet_key_path.read_bytes().strip()
    key = Fernet.generate_key()
    settings.ensure_dirs()
    settings.fernet_key_path.write_bytes(key + b"\n")
    return key


secret_store = SecretStore()