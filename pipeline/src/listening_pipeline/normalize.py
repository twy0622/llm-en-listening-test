"""Unicode-safe answer normalisation. Mirrors normalizeAnswer() in the Worker."""

from __future__ import annotations

import re
import unicodedata


def normalize_answer(value: str) -> str:
    text = unicodedata.normalize("NFKC", value)
    text = text.lower()
    text = re.sub(r"[\u2010-\u2015]", " ", text)
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = re.sub(r"[^\w\s'-]", " ", text, flags=re.UNICODE)
    text = text.replace("_", " ")
    return re.sub(r"\s+", " ", text).strip()


def is_gapfill_correct(response: str, accepted: list[str]) -> bool:
    normalized = normalize_answer(response)
    if not normalized:
        return False
    return any(normalize_answer(candidate) == normalized for candidate in accepted)


def contains_answer(transcript: str, answer: str) -> bool:
    """True when the answer appears as a whole word or phrase in the transcript."""
    haystack = f" {normalize_answer(transcript)} "
    needle = normalize_answer(answer)
    if not needle:
        return False
    return f" {needle} " in haystack


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))
