"""Optional LLM parser for emails that rules cannot confidently classify.

Supports OpenAI, xAI Grok (OpenAI-compatible), and Anthropic Claude. The LLM is
never required: failures return None and the rules result is used instead.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx
from pydantic import BaseModel, Field, field_validator

from ..models import STAGES

logger = logging.getLogger(__name__)


class LLMParsedEmail(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    stage: Optional[str] = None
    location: Optional[str] = None
    next_action: Optional[str] = None
    deadline: Optional[str] = Field(
        default=None, description="ISO date (YYYY-MM-DD) for an explicit deadline, else null"
    )
    response_window_days: Optional[int] = Field(default=None, ge=0, le=365)
    response_window_business_days: bool = False
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)

    @field_validator("stage")
    @classmethod
    def valid_stage(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip().lower()
        return value if value in STAGES else None

    @field_validator("company", "role", "location", "next_action", "deadline")
    @classmethod
    def clean_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = " ".join(value.split()).strip()
        if not value or value.lower() in {"null", "none", "unknown", "n/a"}:
            return None
        return value[:160]


PROVIDER_DEFAULTS = {
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "grok": {"base_url": "https://api.x.ai/v1", "model": "grok-3-mini"},
    "claude": {"base_url": "https://api.anthropic.com/v1", "model": "claude-sonnet-4-5"},
}

PROVIDERS = tuple(PROVIDER_DEFAULTS)


def provider_defaults(provider: Optional[str]) -> dict:
    return PROVIDER_DEFAULTS.get((provider or "openai").lower(), PROVIDER_DEFAULTS["openai"])


@dataclass
class LLMConfig:
    provider: str = "openai"
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    timeout: float = 20.0

    def __post_init__(self) -> None:
        provider = (self.provider or "openai").lower()
        self.provider = provider if provider in PROVIDER_DEFAULTS else "openai"
        defaults = provider_defaults(self.provider)
        self.base_url = (self.base_url or defaults["base_url"]).rstrip("/")
        self.model = self.model or defaults["model"]

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    @property
    def endpoint(self) -> str:
        if self.provider == "claude":
            if self.base_url.endswith("/v1"):
                return f"{self.base_url}/messages"
            return f"{self.base_url}/v1/messages"
        return f"{self.base_url}/chat/completions"


_SYSTEM_PROMPT = """You extract structured data from recruiting emails.
Return ONLY a JSON object with this schema:
{
  "company": string|null,
  "role": string|null,
  "stage": "applied"|"assessment"|"interview"|"offer"|"rejected"|"withdrawn"|null,
  "location": string|null,
  "next_action": short string|null,
  "deadline": "YYYY-MM-DD"|null,
  "response_window_days": integer|null,
  "response_window_business_days": boolean,
  "confidence": 0.0-1.0,
  "evidence": [short quotes from the email]
}
Rules:
- Use null when the email does not state something. Never guess a company or role.
- deadline is only for an explicit date in the email.
- response_window_days is only for an explicit relative window ("within 2 weeks" = 14).
- stage "rejected" means the candidate was rejected. "offer" means a job offer.
- evidence must be short verbatim snippets supporting the fields."""


def _extract_json(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(raw[start : end + 1])


def _request_parts(config: LLMConfig, user_content: str) -> tuple[dict, dict]:
    if config.provider == "claude":
        headers = {
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": config.model,
            "max_tokens": 1024,
            "temperature": 0,
            "system": _SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_content}],
        }
        return headers, payload

    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": config.model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }
    return headers, payload


def _response_text(config: LLMConfig, data: dict) -> str:
    if config.provider == "claude":
        return "".join(
            block.get("text", "")
            for block in (data.get("content") or [])
            if block.get("type") == "text"
        )
    return data["choices"][0]["message"]["content"]


def parse_with_llm(
    text: str,
    *,
    subject: str = "",
    config: LLMConfig,
) -> Optional[dict]:
    if not config.configured:
        return None
    user_content = f"Subject: {subject or '(none)'}\n\nBody:\n{text[:12000]}"
    headers, payload = _request_parts(config, user_content)
    try:
        with httpx.Client(timeout=config.timeout) as client:
            response = client.post(config.endpoint, headers=headers, json=payload)
            response.raise_for_status()
            content = _response_text(config, response.json())
        parsed = LLMParsedEmail.model_validate(_extract_json(content))
    except Exception as exc:  # pragma: no cover - network/provider dependent
        logger.warning("LLM parse failed (%s): %s", config.provider, exc)
        return None
    return parsed.model_dump()
