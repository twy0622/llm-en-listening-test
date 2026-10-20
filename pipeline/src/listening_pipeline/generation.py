from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from .config import Settings
from .models import (
    Accent,
    Level,
    LlmGapfill,
    LlmMcq,
    LlmSubjective,
    PackGapfill,
    PackMcq,
    PackQuestion,
    PackSubjective,
    PassagePack,
    RawPassage,
    TestPack,
    TopicCard,
)
from .prompts import build_repair_messages, build_writer_messages
from .providers import ProviderChain, ProviderError, build_provider_chain
from .season import season_for_date
from .topics import TopicStore, generate_topic_cards
from .validate import PackValidationError, assert_valid_pack, validate_raw_passage

logger = logging.getLogger(__name__)


class GenerationError(RuntimeError):
    pass


def _format_validation_error(error: ValidationError) -> list[str]:
    lines: list[str] = []
    for issue in error.errors():
        location = ".".join(str(part) for part in issue["loc"])
        lines.append(f"{location}: {issue['msg']}")
    return lines


def generate_raw_passage(
    chain: ProviderChain,
    card: TopicCard,
    level: Level,
    accent: Accent,
    *,
    max_attempts: int = 3,
) -> RawPassage:
    messages = build_writer_messages(card, level, accent)
    last_errors: list[str] = []

    for attempt in range(1, max_attempts + 1):
        logger.info(
            "Writing %s for %s (%s), attempt %s/%s",
            card.kind,
            card.domain,
            level,
            attempt,
            max_attempts,
        )
        try:
            data, response = chain.complete_json(messages, max_tokens=2200, temperature=0.75)
        except ProviderError as error:
            # A transient provider/JSON failure should consume an attempt and
            # retry, not abort the whole paper.
            last_errors = [str(error)]
            logger.warning("Writer provider failed: %s", error)
            continue

        try:
            raw = RawPassage.model_validate(data)
        except ValidationError as error:
            last_errors = _format_validation_error(error)
            messages = build_repair_messages(messages, response.text, last_errors)
            continue

        validation = validate_raw_passage(raw, card, level)
        if validation.ok:
            if validation.warnings:
                for warning in validation.warnings:
                    logger.warning("Writer warning: %s", warning)
            return raw

        last_errors = validation.errors
        logger.warning("Writer output rejected: %s", "; ".join(last_errors[:5]))
        messages = build_repair_messages(messages, response.text, last_errors)

    raise GenerationError(
        f"Could not produce a valid {card.kind} after {max_attempts} attempts: "
        + "; ".join(last_errors[:8])
    )


def to_pack_questions(raw: RawPassage, passage_id: str) -> list[PackQuestion]:
    questions: list[PackQuestion] = []
    for position, question in enumerate(raw.questions, start=1):
        common = {
            "id": f"q_{uuid.uuid4().hex[:12]}",
            "position": position,
            "prompt": question.prompt,
            "explanation": question.explanation,
            "skill": question.skill,
            "points": 1,
        }
        if isinstance(question, LlmMcq):
            questions.append(
                PackMcq(
                    **common,
                    type="mcq",
                    choices=question.choices,
                    answer=question.answer,
                )
            )
        elif isinstance(question, LlmGapfill):
            questions.append(
                PackGapfill(
                    **common,
                    type="gapfill",
                    answer=question.answer,
                )
            )
        elif isinstance(question, LlmSubjective):
            questions.append(
                PackSubjective(
                    **common,
                    type="subjective",
                    answer=question.answer,
                )
            )
        else:  # pragma: no cover - guarded by the discriminated union
            raise GenerationError(f"Unsupported question type for passage {passage_id}")
    return questions


def _clean_title(raw_passages: list[RawPassage]) -> str:
    titles = [raw.title.strip().rstrip(".") for raw in raw_passages]
    title = " · ".join(titles)
    return title[:157].rstrip(" ·") or "A listening paper"


def generate_test_pack(
    *,
    settings: Settings,
    level: Level,
    accent: Accent,
    seed: int,
    out_dir: Path,
    chain: ProviderChain | None = None,
    cards: list[TopicCard] | None = None,
    season: str | None = None,
) -> tuple[TestPack, Path]:
    """Generate one two-section paper, synthesise audio, validate, and write it.

    The returned directory contains `test.json` and `audio/<passageId>.mp3`.
    """

    from .audio import synthesize_passage  # lazy: keeps text-only tooling light

    test_id = f"test_{uuid.uuid4().hex[:12]}"
    pack_dir = out_dir / test_id
    audio_dir = pack_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    store = TopicStore(out_dir / "topics.jsonl")
    chain = chain or build_provider_chain(settings)

    if cards is None:
        monologue = generate_topic_cards(
            "monologue", level, 1, seed=seed, store=store
        )[0]
        dialogue = generate_topic_cards(
            "dialogue", level, 1, seed=seed + 1, store=store
        )[0]
        cards = [monologue, dialogue]
    if len(cards) != 2:
        raise GenerationError("A pack needs exactly two scenario cards")

    passages: list[PassagePack] = []
    raws: list[RawPassage] = []

    for position, card in enumerate(cards, start=1):
        raw = generate_raw_passage(chain, card, level, accent)
        raws.append(raw)
        passage_id = f"p_{uuid.uuid4().hex[:12]}"
        questions = to_pack_questions(raw, passage_id)
        audio_ref = synthesize_passage(
            raw=raw,
            level=level,
            accent=accent,
            seed=seed + position * 101,
            output_path=audio_dir / f"{passage_id}.mp3",
            audio_key=f"audio/{test_id}/{passage_id}.mp3",
        )
        passages.append(
            PassagePack(
                id=passage_id,
                position=position,
                type=card.kind,
                topic=raw.topic,
                transcript=raw.transcript.strip(),
                audio=audio_ref,
                topicCard=card,
                questions=questions,
            )
        )

    pack = TestPack(
        schemaVersion=1,
        id=test_id,
        title=_clean_title(raws),
        level=level,
        accent=accent,
        durationSec=300 * len(passages),
        createdAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        season=season or season_for_date(),
        passages=passages,
    )

    try:
        assert_valid_pack(pack)
    except PackValidationError:
        # Keep the failed artefacts for inspection; the caller decides whether to print.
        (pack_dir / "rejected.json").write_text(
            pack.model_dump_json(by_alias=True, indent=2), encoding="utf-8"
        )
        raise

    (pack_dir / "test.json").write_text(
        pack.model_dump_json(by_alias=True, indent=2, exclude_none=True), encoding="utf-8"
    )
    for card in cards:
        store.add(card)

    return pack, pack_dir


def generate_many(
    *,
    settings: Settings,
    level: Level,
    accent: Accent,
    seed: int,
    out_dir: Path,
    count: int,
    season: str | None = None,
) -> list[tuple[TestPack, Path]]:
    results: list[tuple[TestPack, Path]] = []
    for index in range(count):
        pack, path = generate_test_pack(
            settings=settings,
            level=level,
            accent=accent,
            seed=seed + index * 1000,
            out_dir=out_dir,
            season=season,
        )
        results.append((pack, path))
        logger.info("Wrote %s (%s)", pack.id, path)
    return results
