from __future__ import annotations

from app.parser import llm


class FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class FakeClient:
    calls = []
    response_data = {}

    def __init__(self, timeout=None):
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def post(self, url, headers, json):
        FakeClient.calls.append({"url": url, "headers": headers, "json": json})
        return FakeResponse(FakeClient.response_data)


def test_provider_defaults():
    claude = llm.LLMConfig(provider="claude", api_key="key")
    assert claude.base_url == "https://api.anthropic.com/v1"
    assert claude.endpoint == "https://api.anthropic.com/v1/messages"
    assert claude.model == llm.PROVIDER_DEFAULTS["claude"]["model"]

    grok = llm.LLMConfig(provider="grok", api_key="key")
    assert grok.endpoint == "https://api.x.ai/v1/chat/completions"

    openai = llm.LLMConfig(api_key="key")
    assert openai.endpoint == "https://api.openai.com/v1/chat/completions"


def test_claude_request_and_response(monkeypatch):
    FakeClient.calls = []
    FakeClient.response_data = {
        "content": [
            {
                "type": "text",
                "text": "```json\n"
                '{"company": "Acme", "role": "SWE Intern", "stage": "interview", '
                '"confidence": 0.8, "evidence": ["interview"]}\n```',
            }
        ]
    }
    monkeypatch.setattr(llm.httpx, "Client", FakeClient)

    result = llm.parse_with_llm(
        "We would like to interview you.",
        subject="Next steps",
        config=llm.LLMConfig(provider="claude", api_key="sk-ant-test"),
    )

    assert result["company"] == "Acme"
    assert result["stage"] == "interview"
    call = FakeClient.calls[0]
    assert call["url"] == "https://api.anthropic.com/v1/messages"
    assert call["headers"]["x-api-key"] == "sk-ant-test"
    assert "anthropic-version" in call["headers"]
    assert call["json"]["system"]
    assert call["json"]["messages"][0]["role"] == "user"
    assert "response_format" not in call["json"]


def test_openai_compatible_request(monkeypatch):
    FakeClient.calls = []
    FakeClient.response_data = {
        "choices": [
            {
                "message": {
                    "content": '{"company": "Globex", "stage": "applied", '
                    '"confidence": 0.7, "evidence": []}'
                }
            }
        ]
    }
    monkeypatch.setattr(llm.httpx, "Client", FakeClient)

    result = llm.parse_with_llm(
        "Thanks for applying.",
        subject="Application received",
        config=llm.LLMConfig(provider="grok", api_key="xai-test"),
    )

    assert result["company"] == "Globex"
    call = FakeClient.calls[0]
    assert call["url"] == "https://api.x.ai/v1/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer xai-test"
    assert call["json"]["response_format"] == {"type": "json_object"}


def test_missing_key_skips_request(monkeypatch):
    FakeClient.calls = []
    monkeypatch.setattr(llm.httpx, "Client", FakeClient)
    assert llm.parse_with_llm("text", config=llm.LLMConfig(provider="openai")) is None
    assert FakeClient.calls == []
