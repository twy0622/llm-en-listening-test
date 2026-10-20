import json

import httpx
import pytest

from listening_pipeline.config import Settings
from listening_pipeline.providers import GeminiProvider, OpenCodeProvider, build_provider_chain


def test_gemini_provider_parses_json_response():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        captured["key"] = request.headers.get("x-goog-api-key")
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"text": '{"score": 0.5, "feedback": "ok"}'}]}}
                ]
            },
        )

    settings = Settings(gemini_api_key="test-key", gemini_model="gemini-3-flash")
    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    text = provider.complete(
        [
            {"role": "system", "content": "Return JSON."},
            {"role": "user", "content": "Grade this."},
        ],
        max_tokens=100,
        temperature=0.2,
        json_mode=True,
    )

    assert json.loads(text)["score"] == 0.5
    assert captured["key"] == "test-key"
    assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert captured["body"]["systemInstruction"]["parts"][0]["text"] == "Return JSON."


def test_opencode_without_key_is_not_in_chain():
    settings = Settings(opencode_api_key="", gemini_api_key="test-key")
    chain = build_provider_chain(settings)
    assert [provider.name for provider in chain.providers] == ["gemini"]


def test_chain_requires_at_least_one_provider():
    settings = Settings(opencode_api_key="", gemini_api_key="", cf_account_id="", cf_api_token="")
    with pytest.raises(Exception, match="No LLM provider configured"):
        build_provider_chain(settings)


def test_opencode_requires_key():
    settings = Settings(opencode_api_key="")
    assert OpenCodeProvider(settings).configured is False
