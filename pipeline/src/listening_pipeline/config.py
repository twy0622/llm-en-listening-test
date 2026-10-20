from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    opencode_base_url: str = _env("OPENCODE_BASE_URL", "https://opencode.ai")
    opencode_model: str = _env("OPENCODE_MODEL", "deepseek-v4.1-flash-free")
    opencode_api_key: str = _env("OPENCODE_API_KEY")
    cf_account_id: str = _env("CF_ACCOUNT_ID")
    cf_api_token: str = _env("CF_API_TOKEN")
    cf_ai_model: str = _env("CF_AI_MODEL", "@cf/meta/llama-3.1-8b-instruct-fp8-fast")
    gemini_api_key: str = _env("GEMINI_API_KEY")
    gemini_model: str = _env("GEMINI_MODEL", "gemini-3-flash")
    admin_api_url: str = _env("ADMIN_API_URL", "http://localhost:8787")
    admin_token: str = _env("ADMIN_TOKEN", "dev-admin-token-replace-me")
    out_dir: Path = Path(_env("OUT_DIR", "out"))
    request_timeout: float = float(_env("REQUEST_TIMEOUT", "90"))


settings = Settings()
