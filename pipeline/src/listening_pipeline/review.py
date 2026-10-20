"""Offline editorial review. The judge is deliberately separate from generation."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .models import PackReview, ReviewVerdict, TestPack
from .prompts import build_review_messages
from .providers import ProviderChain


class ReviewError(RuntimeError):
    pass


def _notes(verdict: ReviewVerdict) -> str:
    lines = [verdict.summary.strip()]
    for issue in verdict.issues:
        lines.append(f"[{issue.severity}] {issue.location}: {issue.message}")
    return "\n".join(line for line in lines if line)[:4000]


def review_pack(
    pack: TestPack,
    chain: ProviderChain,
    *,
    min_score: float = 80,
) -> PackReview:
    """Ask the judge to audit a pack and return a conservative review record."""
    data, response = chain.complete_json(
        build_review_messages(pack),
        max_tokens=1600,
        temperature=0.1,
    )
    try:
        verdict = ReviewVerdict.model_validate(data)
    except Exception as error:  # noqa: BLE001 - surface a useful factory error
        raise ReviewError(f"Judge returned an invalid review: {error}") from error

    blockers = [issue for issue in verdict.issues if issue.severity == "blocker"]
    approved = verdict.status == "approved" and verdict.score >= min_score and not blockers
    status = "approved" if approved else "rejected"

    return PackReview(
        status=status,
        score=verdict.score,
        judge=response.provider,
        reviewedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        notes=_notes(verdict),
    )


def write_review(pack_dir: Path, review: PackReview) -> Path:
    path = pack_dir / "review.json"
    path.write_text(
        json.dumps(review.model_dump(by_alias=True, exclude_none=True), indent=2),
        encoding="utf-8",
    )
    return path
