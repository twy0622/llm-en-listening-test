"""Kokoro narration with one cached pipeline per language.

The original app constructed a KPipeline on every call. Here pipelines (and the
underlying model) are built once per process and reused; each passage is encoded
to 64 kbps mono MP3 so 10 GB of R2 holds thousands of tests.
"""

from __future__ import annotations

import logging
import random
import re
from functools import lru_cache
from pathlib import Path

import numpy as np

from .models import Accent, AudioRef, Level, RawPassage
from .normalize import word_count
from .validate import parse_dialogue_turns

logger = logging.getLogger(__name__)

SAMPLE_RATE = 24_000
SPEED: dict[Level, float] = {"A2": 0.93, "B1": 0.98, "B2": 1.02, "C1": 1.06}

VOICES: dict[str, dict[str, tuple[str, ...]]] = {
    "us": {
        "female": ("af_heart", "af_bella", "af_nicole", "af_sarah"),
        "male": ("am_michael", "am_adam", "am_onyx"),
    },
    "uk": {
        "female": ("bf_emma", "bf_isabella"),
        "male": ("bm_george", "bm_lewis"),
    },
}

ABBREVIATIONS = (
    (re.compile(r"\be\.g\.", re.IGNORECASE), "for example"),
    (re.compile(r"\bi\.e\.", re.IGNORECASE), "that is"),
    (re.compile(r"\bDr\.", re.IGNORECASE), "Doctor"),
    (re.compile(r"\bMr\.", re.IGNORECASE), "Mister"),
    (re.compile(r"\bMrs\.", re.IGNORECASE), "Missus"),
    (re.compile(r"\bMs\.", re.IGNORECASE), "Miz"),
    (re.compile(r"\bvs\.", re.IGNORECASE), "versus"),
    (re.compile(r"\bSt\.", re.IGNORECASE), "Street"),
)

STAGE_DIRECTION = re.compile(
    r"\((?:laughs?|sighs?|pause[sd]?|smiles?|hesitates?|clears throat)\)",
    re.IGNORECASE,
)


class AudioSynthesisError(RuntimeError):
    pass


@lru_cache(maxsize=4)
def get_pipeline(lang_code: str):
    """One KPipeline per language for the whole process (Kokoro caches voices)."""
    if lang_code not in {"a", "b"}:
        raise AudioSynthesisError(f"Unsupported Kokoro language code: {lang_code}")
    try:
        from kokoro import KPipeline
    except ImportError as error:  # pragma: no cover - depends on optional install
        raise AudioSynthesisError(
            "Kokoro is not installed. Run `pip install -e '.[dev]'` in pipeline/."
        ) from error
    logger.info("Loading Kokoro pipeline (lang_code=%s); first run may download the model", lang_code)
    return KPipeline(lang_code=lang_code)


def sanitize_for_tts(text: str) -> str:
    cleaned = STAGE_DIRECTION.sub(" ", text)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", cleaned)  # [word](/ipa/) -> word
    cleaned = cleaned.replace("**", "").replace("__", "")
    cleaned = cleaned.replace("&", " and ")
    cleaned = cleaned.replace("%", " percent")
    cleaned = cleaned.replace("£", " pounds ")
    cleaned = cleaned.replace("$", " dollars ")
    cleaned = cleaned.replace("€", " euros ")
    cleaned = cleaned.replace("\u2019", "'").replace("\u2018", "'")
    cleaned = cleaned.replace("\u201c", '"').replace("\u201d", '"')
    for pattern, replacement in ABBREVIATIONS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _pick_voice(accent: Accent, gender: str, rng: random.Random) -> tuple[str, str]:
    language = accent
    if accent == "mixed":
        language = rng.choice(("us", "uk"))
    pool = VOICES[language][gender]
    return rng.choice(pool), ("a" if language == "us" else "b")


def _to_numpy(audio) -> np.ndarray:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    return np.asarray(audio, dtype=np.float32).reshape(-1)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32)


def _synthesize_text(text: str, voice: str, lang_code: str, speed: float) -> np.ndarray:
    pipeline = get_pipeline(lang_code)
    chunks: list[np.ndarray] = []
    try:
        for _, _, audio in pipeline(
            text,
            voice=voice,
            speed=speed,
            split_pattern=None,
        ):
            chunks.append(_to_numpy(audio))
    except Exception as error:  # noqa: BLE001 - wrap vendor errors with context
        raise AudioSynthesisError(f"Kokoro failed for voice {voice}: {error}") from error
    if not chunks:
        raise AudioSynthesisError("Kokoro returned no audio")
    return np.concatenate(chunks)


def synthesize_monologue(
    raw: RawPassage,
    *,
    level: Level,
    accent: Accent,
    rng: random.Random,
) -> np.ndarray:
    gender = raw.gender or "female"
    voice, lang_code = _pick_voice(accent, gender, rng)
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw.transcript) if p.strip()]
    if not paragraphs:
        raise AudioSynthesisError("Monologue transcript is empty")

    chunks: list[np.ndarray] = [_silence(0.35)]
    for index, paragraph in enumerate(paragraphs):
        text = sanitize_for_tts(paragraph)
        if text:
            chunks.append(_synthesize_text(text, voice, lang_code, SPEED[level]))
        if index < len(paragraphs) - 1:
            chunks.append(_silence(0.42))
    chunks.append(_silence(0.55))
    return np.concatenate(chunks)


def synthesize_dialogue(
    raw: RawPassage,
    *,
    level: Level,
    accent: Accent,
    rng: random.Random,
) -> np.ndarray:
    turns, errors = parse_dialogue_turns(raw.transcript)
    if errors:
        raise AudioSynthesisError("; ".join(errors))
    if not turns:
        raise AudioSynthesisError("Dialogue transcript has no turns")

    first_gender = rng.choice(("male", "female"))
    second_gender = "female" if first_gender == "male" else "male"
    voice_a, lang_a = _pick_voice(accent, first_gender, rng)
    voice_b, lang_b = _pick_voice(accent, second_gender, rng)
    # Keep one language per passage so the two voices share an accent.
    if lang_a != lang_b:
        voice_b, lang_b = _pick_voice(accent if accent != "mixed" else "us", second_gender, rng)

    voices = {"A": (voice_a, lang_a), "B": (voice_b, lang_b)}
    chunks: list[np.ndarray] = [_silence(0.35)]
    previous_speaker: str | None = None
    for speaker, text in turns:
        cleaned = sanitize_for_tts(text)
        if not cleaned:
            continue
        if previous_speaker and previous_speaker != speaker:
            chunks.append(_silence(0.62))
        elif previous_speaker:
            chunks.append(_silence(0.35))
        voice, lang_code = voices[speaker]
        chunks.append(_synthesize_text(cleaned, voice, lang_code, SPEED[level]))
        previous_speaker = speaker
    chunks.append(_silence(0.6))
    if len(chunks) <= 2:
        raise AudioSynthesisError("Dialogue produced no audible turns")
    return np.concatenate(chunks)


def _write_mp3(audio: np.ndarray, path: Path) -> None:
    try:
        import lameenc
    except ImportError:  # pragma: no cover - optional fallback
        import soundfile as sf

        wav_path = path.with_suffix(".wav")
        sf.write(wav_path, audio, SAMPLE_RATE, subtype="PCM_16")
        raise _WavFallback(wav_path)

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(64)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    payload = encoder.encode(pcm) + encoder.flush()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


class _WavFallback(Exception):
    def __init__(self, path: Path) -> None:
        self.path = path


def synthesize_passage(
    *,
    raw: RawPassage,
    level: Level,
    accent: Accent,
    seed: int,
    output_path: Path,
    audio_key: str,
) -> AudioRef:
    rng = random.Random(seed)
    if re.search(r"^\s*[AB]\s*[:：]", raw.transcript, re.MULTILINE):
        audio = synthesize_dialogue(raw, level=level, accent=accent, rng=rng)
    else:
        audio = synthesize_monologue(raw, level=level, accent=accent, rng=rng)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    actual_path = output_path
    mime = "audio/mpeg"
    try:
        _write_mp3(audio, output_path)
    except _WavFallback as fallback:
        actual_path = fallback.path
        mime = "audio/wav"
        logger.warning("lameenc unavailable; wrote WAV instead of MP3: %s", actual_path)

    duration = round(len(audio) / SAMPLE_RATE, 2)
    key = audio_key
    if mime == "audio/wav":
        key = str(Path(audio_key).with_suffix(".wav"))

    logger.info(
        "Narrated %s words in %.1fs -> %s",
        word_count(raw.transcript),
        duration,
        actual_path.name,
    )
    return AudioRef(key=key, mime=mime, durationSec=duration)
