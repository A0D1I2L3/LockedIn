"""Encrypted storage for OAuth client credentials and per-user LLM keys.

The Google client secret and any LLM API keys are sensitive, so they are
encrypted at rest in a small JSON file under `data/`. A per-install Fernet key
is generated on first use; set `SECRET_KEY` for a stable deployment key.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


class SecretStore:
    def __init__(self, key: Optional[bytes] = None, path=None) -> None:
        self.path = path or settings.secret_store_path
        self._fernet = Fernet(key) if key is not None else Fernet(fernet_key_bytes())

    def set(self, name: str, value: str) -> None:
        data = self._read_all()
        data[name] = self._fernet.encrypt(value.encode()).decode()
        self._write_all(data)

    def get(self, name: str) -> Optional[str]:
        token = self._read_all().get(name)
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

    def clear(self, name: str) -> None:
        data = self._read_all()
        if data.pop(name, None) is not None:
            self._write_all(data)

    def all_names(self) -> list[str]:
        return list(self._read_all().keys())

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


def fernet_key_bytes() -> bytes:
    """Return (and lazily create) the shared encryption key bytes."""
    if settings.secret_key:
        digest = hashlib.sha256(settings.secret_key.encode()).digest()
        return base64.urlsafe_b64encode(digest)
    if settings.fernet_key_path.exists():
        return settings.fernet_key_path.read_bytes().strip()
    key = Fernet.generate_key()
    settings.ensure_dirs()
    settings.fernet_key_path.write_bytes(key + b"\n")
    return key


secret_store = SecretStore()
