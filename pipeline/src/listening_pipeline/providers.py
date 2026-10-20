from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from .config import Settings

try:  # Use the OS trust store so corporate TLS-inspection roots work locally.
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover - optional on minimal installs
    pass

logger = logging.getLogger(__name__)


class ProviderError(RuntimeError):
    pass


class JsonParseError(ProviderError):
    pass


@dataclass
class LlmResponse:
    text: str
    provider: str


class LlmProvider(Protocol):
    name: str

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float,
        json_mode: bool,
    ) -> str: ...


class OpenCodeProvider:
    """OpenCode Inference (OpenAI-compatible), for accounts with a usable key."""

    name = "opencode"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.model = settings.opencode_model
        self.api_key = settings.opencode_api_key
        self.base_url = settings.opencode_base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=settings.request_timeout)

    @property
    def configured(self) -> bool:
        # OpenCode's free tier is intentionally app-only and returns 403 to
        # external clients. A paid Zen key can still be used if supplied.
        return bool(self.api_key)

    def _post(self, payload: dict[str, Any]) -> httpx.Response:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        return self.client.post(
            f"{self.base_url}/inference/openai/v1/chat/completions",
            headers=headers,
            json=payload,
        )

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float,
        json_mode: bool,
    ) -> str:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            response = self._post(payload)
            if response.status_code in (400, 422) and json_mode:
                # Not every free model supports response_format. The prompts are
                # explicit about JSON, so try once without it.
                payload.pop("response_format", None)
                response = self._post(payload)
        except httpx.HTTPError as error:
            raise ProviderError(f"OpenCode request failed: {error}") from error

        if response.status_code >= 400:
            raise ProviderError(
                f"OpenCode {response.status_code}: {response.text[:400]}"
            )

        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise ProviderError(f"Unexpected OpenCode response: {response.text[:400]}") from error

        if isinstance(content, list):
            content = "".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        if not isinstance(content, str) or not content.strip():
            raise ProviderError("OpenCode returned empty content")
        return content


class WorkersAiProvider:
    """Cloudflare Workers AI REST fallback (needs account id + API token)."""

    name = "workers-ai"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.account_id = settings.cf_account_id
        self.api_token = settings.cf_api_token
        self.model = settings.cf_ai_model
        self.client = client or httpx.Client(timeout=settings.request_timeout)

    @property
    def configured(self) -> bool:
        return bool(self.account_id and self.api_token)

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float,
        json_mode: bool,
    ) -> str:
        if not self.configured:
            raise ProviderError("Workers AI is not configured")
        url = (
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{self.account_id}/ai/run/{self.model}"
        )
        try:
            response = self.client.post(
                url,
                headers={"authorization": f"Bearer {self.api_token}"},
                json={
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
        except httpx.HTTPError as error:
            raise ProviderError(f"Workers AI request failed: {error}") from error

        if response.status_code >= 400:
            raise ProviderError(
                f"Workers AI {response.status_code}: {response.text[:400]}"
            )

        try:
            data = response.json()
            result = data.get("result", data)
            content = result.get("response") if isinstance(result, dict) else result
            if not isinstance(content, str) and isinstance(result, dict):
                # Some OpenAI-compatible deployments return choices instead of
                # the classic Workers AI {response: ...} envelope.
                choices = result.get("choices")
                if isinstance(choices, list) and choices:
                    message = choices[0].get("message", {})
                    content = message.get("content") if isinstance(message, dict) else None
        except ValueError as error:
            raise ProviderError(f"Unexpected Workers AI response: {response.text[:400]}") from error

        if not isinstance(content, str) or not content.strip():
            raise ProviderError("Workers AI returned empty content")
        return content


class GeminiProvider:
    """Google AI Studio / Gemini API fallback (free tier available)."""

    name = "gemini"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.api_key = settings.gemini_api_key
        self.model = settings.gemini_model
        self.client = client or httpx.Client(timeout=settings.request_timeout)

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float,
        json_mode: bool,
    ) -> str:
        if not self.configured:
            raise ProviderError("Gemini is not configured")

        system_parts = [message["content"] for message in messages if message["role"] == "system"]
        contents = [
            {
                "role": "model" if message["role"] == "assistant" else "user",
                "parts": [{"text": message["content"]}],
            }
            for message in messages
            if message["role"] != "system"
        ]
        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
                **({"responseMimeType": "application/json"} if json_mode else {}),
            },
        }
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}

        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )

        def post(body: dict[str, Any]) -> httpx.Response:
            try:
                return self.client.post(
                    url,
                    headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
                    json=body,
                )
            except httpx.HTTPError as error:
                raise ProviderError(f"Gemini request failed: {error}") from error

        response = post(payload)
        if response.status_code in (400, 422) and json_mode:
            # Not every model supports responseMimeType. The prompt still asks
            # for JSON and the extractor tolerates fences.
            payload["generationConfig"].pop("responseMimeType", None)
            response = post(payload)

        if response.status_code >= 400:
            raise ProviderError(f"Gemini {response.status_code}: {response.text[:400]}")

        try:
            data = response.json()
            parts = data["candidates"][0]["content"]["parts"]
            content = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise ProviderError(f"Unexpected Gemini response: {response.text[:400]}") from error

        if not content.strip():
            raise ProviderError("Gemini returned empty content")
        return content


class ProviderChain:
    """Try providers in order; surface every failure if they all fail."""

    def __init__(self, providers: list[LlmProvider]) -> None:
        self.providers = providers

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 1600,
        temperature: float = 0.7,
        json_mode: bool = True,
    ) -> LlmResponse:
        errors: list[str] = []
        for provider in self.providers:
            try:
                text = provider.complete(
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    json_mode=json_mode,
                )
                return LlmResponse(text=text, provider=provider.name)
            except Exception as error:  # noqa: BLE001 - fall through the chain
                message = f"{provider.name}: {error}"
                logger.warning("Provider failed: %s", message)
                errors.append(message)
        raise ProviderError("All LLM providers failed: " + " | ".join(errors))

    def complete_json(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 1600,
        temperature: float = 0.7,
    ) -> tuple[dict[str, Any], LlmResponse]:
        response = self.complete(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            json_mode=True,
        )
        return extract_json_object(response.text), response


def extract_json_object(text: str) -> dict[str, Any]:
    trimmed = text.strip()
    trimmed = re.sub(r"^```(?:json)?\s*", "", trimmed, flags=re.IGNORECASE)
    trimmed = re.sub(r"\s*```$", "", trimmed)
    start = trimmed.find("{")
    end = trimmed.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise JsonParseError(f"No JSON object found in model output: {text[:300]}")
    snippet = trimmed[start : end + 1]
    try:
        parsed = json.loads(snippet, strict=False)
    except json.JSONDecodeError as error:
        raise JsonParseError(
            f"Invalid JSON from model ({error.msg} at char {error.pos}): {snippet[:400]}"
        ) from error
    if not isinstance(parsed, dict):
        raise JsonParseError("Model returned JSON that is not an object")
    return parsed


def build_provider_chain(settings: Settings) -> ProviderChain:
    """Build the best available chain for offline generation.

    Workers AI is first because it is free inside Cloudflare and works over its
    REST API; Gemini follows for operators without Cloudflare credentials.
    OpenCode is opt-in because its free tier rejects all external clients.
    """

    providers: list[LlmProvider] = []
    workers = WorkersAiProvider(settings)
    if workers.configured:
        providers.append(workers)
    gemini = GeminiProvider(settings)
    if gemini.configured:
        providers.append(gemini)
    opencode = OpenCodeProvider(settings)
    if opencode.configured:
        providers.append(opencode)

    if not providers:
        raise ProviderError(
            "No LLM provider configured. Set CF_ACCOUNT_ID + CF_API_TOKEN "
            "(Workers AI) or GEMINI_API_KEY in pipeline/.env."
        )
    return ProviderChain(providers)
