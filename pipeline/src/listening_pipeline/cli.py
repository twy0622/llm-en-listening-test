from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .audio import AudioSynthesisError
from .config import settings
from .generation import GenerationError, generate_test_pack
from .models import TestPack
from .providers import ProviderError, build_provider_chain
from .publish import PublishError, load_pack, publish_pack
from .review import ReviewError, review_pack, write_review
from .season import season_for_date
from .topics import TopicStore, cards_json, generate_topic_cards
from .validate import PackValidationError, validate_pack

LEVELS = ("A2", "B1", "B2", "C1")
ACCENTS = ("us", "uk", "mixed")


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )


def cmd_topics(args: argparse.Namespace) -> int:
    store = TopicStore(Path(args.store)) if args.remember else None
    kinds = ("monologue", "dialogue") if args.kind == "both" else (args.kind,)
    output: dict[str, list[dict]] = {}
    for index, kind in enumerate(kinds):
        cards = generate_topic_cards(
            kind,
            args.level,
            args.count,
            seed=args.seed + index * 17,
            store=store,
        )
        if store:
            for card in cards:
                store.add(card)
        output[kind] = [card.model_dump(by_alias=True) for card in cards]
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for index in range(args.count):
        pack, path = generate_test_pack(
            settings=settings,
            level=args.level,
            accent=args.accent,
            seed=args.seed + index * 1000,
            out_dir=out_dir,
            season=args.season,
        )
        results.append((pack, path))
        print(f"generated {pack.id} -> {path}")

    if args.publish:
        for pack, path in results:
            result = publish_pack(
                path,
                api_url=args.api or settings.admin_api_url,
                admin_token=args.token or settings.admin_token,
                publish=not args.draft,
                replace=args.replace,
                require_review=args.require_review,
            )
            print(
                f"published {result.test_id} ({result.status}, "
                f"{result.questions} questions, {result.audio_files} audio files)"
            )
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if path.is_dir():
        pack = load_pack(path)
    else:
        pack = TestPack.model_validate_json(path.read_text(encoding="utf-8"))
    result = validate_pack(pack)
    for warning in result.warnings:
        print(f"warning: {warning}")
    if result.errors:
        for error in result.errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"ok: {pack.id} ({len(pack.passages)} passages, {sum(len(p.questions) for p in pack.passages)} questions)")
    return 0


def cmd_review(args: argparse.Namespace) -> int:
    pack_dir = Path(args.path)
    pack = load_pack(pack_dir)
    review = review_pack(
        pack,
        build_provider_chain(settings),
        min_score=args.min_score,
    )
    path = write_review(pack_dir, review)
    print(
        f"{review.status} {pack.id} "
        f"(score {review.score if review.score is not None else 'n/a'}, "
        f"judge {review.judge or 'unknown'}) -> {path}"
    )
    if review.notes:
        print(review.notes)
    return 0 if review.status == "approved" or not args.require_pass else 1


def cmd_publish(args: argparse.Namespace) -> int:
    result = publish_pack(
        Path(args.path),
        api_url=args.api or settings.admin_api_url,
        admin_token=args.token or settings.admin_token,
        publish=not args.draft,
        replace=args.replace,
        require_review=args.require_review,
    )
    print(
        f"published {result.test_id} ({result.status}, "
        f"{result.questions} questions, {result.audio_files} audio files)"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="listening",
        description="Offline content factory for the All Ears listening exam.",
    )
    parser.add_argument("--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    topics = sub.add_parser("topics", help="print generated scenario cards")
    topics.add_argument("--kind", choices=("monologue", "dialogue", "both"), default="both")
    topics.add_argument("--level", choices=LEVELS, default="B1")
    topics.add_argument("--count", type=int, default=5)
    topics.add_argument("--seed", type=int, default=42)
    topics.add_argument("--store", default=str(settings.out_dir / "topics.jsonl"))
    topics.add_argument("--remember", action="store_true", help="record cards to the store")
    topics.set_defaults(func=cmd_topics)

    generate = sub.add_parser("generate", help="generate, narrate, and validate a paper")
    generate.add_argument("--level", choices=LEVELS, default="B1")
    generate.add_argument("--accent", choices=ACCENTS, default="mixed")
    generate.add_argument("--seed", type=int, default=42)
    generate.add_argument("--count", type=int, default=1, help="number of two-section papers")
    generate.add_argument("--out", default=str(settings.out_dir))
    generate.add_argument(
        "--season",
        default=season_for_date(),
        help="publishing season (YYYY-Q1..Q4 or evergreen)",
    )
    generate.add_argument("--publish", action="store_true", help="import the pack after generation")
    generate.add_argument("--draft", action="store_true", help="import as a draft")
    generate.add_argument("--replace", action="store_true", help="replace an existing draft")
    generate.add_argument(
        "--require-review",
        action="store_true",
        help="only publish if review.json is approved",
    )
    generate.add_argument("--api", default=None)
    generate.add_argument("--token", default=None)
    generate.set_defaults(func=cmd_generate)

    validate = sub.add_parser("validate", help="validate a pack directory or test.json")
    validate.add_argument("path")
    validate.set_defaults(func=cmd_validate)

    review = sub.add_parser("review", help="run the offline editorial judge on a pack")
    review.add_argument("path")
    review.add_argument("--min-score", type=float, default=80)
    review.add_argument("--require-pass", action="store_true", help="exit 1 if rejected")
    review.set_defaults(func=cmd_review)

    publish = sub.add_parser("publish", help="import a generated pack into D1 + R2")
    publish.add_argument("path")
    publish.add_argument("--api", default=None)
    publish.add_argument("--token", default=None)
    publish.add_argument("--draft", action="store_true")
    publish.add_argument("--replace", action="store_true")
    publish.add_argument(
        "--require-review",
        action="store_true",
        help="only publish if review.json is approved",
    )
    publish.set_defaults(func=cmd_publish)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130
    except (
        GenerationError,
        PackValidationError,
        AudioSynthesisError,
        ProviderError,
        PublishError,
        ReviewError,
        ValueError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
