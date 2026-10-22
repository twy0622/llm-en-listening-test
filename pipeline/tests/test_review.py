import json
from pathlib import Path

import pytest

from factories import test_pack as make_pack
from listening_pipeline.providers import LlmResponse
from listening_pipeline.review import ReviewError, review_pack, write_review


class FakeChain:
    """A judge stub: returns one canned verdict and records the call."""

    def __init__(self, data: dict):
        self.data = data
        self.calls = 0

    def complete_json(self, messages, *, max_tokens, temperature):
        self.calls += 1
        return self.data, LlmResponse(text=json.dumps(self.data), provider="fake-judge")


def verdict(status="approved", score=88, issues=None, summary="Solid paper."):
    return {
        "status": status,
        "score": score,
        "summary": summary,
        "issues": issues or [],
    }


def test_high_scoring_approval_is_recorded():
    chain = FakeChain(
        verdict(issues=[{"location": "q3", "severity": "minor", "message": "Weak distractor."}])
    )

    review = review_pack(make_pack(), chain, min_score=80)

    assert review.status == "approved"
    assert review.score == 88
    assert review.judge == "fake-judge"
    assert review.reviewed_at is not None and review.reviewed_at.endswith("Z")
    assert "Solid paper." in review.notes
    assert "[minor] q3: Weak distractor." in review.notes
    assert chain.calls == 1


def test_score_below_threshold_is_rejected():
    review = review_pack(make_pack(), FakeChain(verdict(score=79)), min_score=80)

    assert review.status == "rejected"
    assert review.score == 79


def test_score_at_threshold_is_approved():
    review = review_pack(make_pack(), FakeChain(verdict(score=80)), min_score=80)

    assert review.status == "approved"


def test_any_blocker_rejects_even_a_high_score():
    review = review_pack(
        make_pack(),
        FakeChain(
            verdict(
                score=95,
                issues=[{"location": "q2", "severity": "blocker", "message": "Key is wrong."}],
            )
        ),
    )

    assert review.status == "rejected"
    assert "[blocker] q2: Key is wrong." in review.notes


def test_judge_rejection_is_preserved():
    review = review_pack(make_pack(), FakeChain(verdict(status="rejected", score=90)))

    assert review.status == "rejected"


def test_invalid_judge_output_raises_a_factory_error():
    with pytest.raises(ReviewError, match="invalid review"):
        review_pack(make_pack(), FakeChain({"status": "approved"}))


def test_write_review_uses_the_wire_alias_and_skips_empty_fields(tmp_path: Path):
    review = review_pack(make_pack(), FakeChain(verdict()))
    path = write_review(tmp_path, review)

    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["status"] == "approved"
    assert raw["reviewedAt"] == review.reviewed_at
    assert "reviewed_at" not in raw
