import json
from pathlib import Path

import pytest

from factories import test_pack as make_pack
from listening_pipeline.publish import PublishError, publish_pack


def write_pack(pack_dir: Path, *, review_status: str | None = None) -> Path:
    pack = make_pack()
    if review_status is not None:
        from listening_pipeline.models import PackReview

        pack.review = PackReview(status=review_status, score=40)
    (pack_dir / "test.json").write_text(
        json.dumps(pack.model_dump(by_alias=True, exclude_none=True)),
        encoding="utf-8",
    )
    return pack_dir


def test_require_review_refuses_a_pack_without_review_json(tmp_path: Path):
    write_pack(tmp_path)

    with pytest.raises(PublishError, match="approved review.json"):
        publish_pack(
            tmp_path,
            api_url="http://127.0.0.1:1",
            admin_token="unused",
            require_review=True,
        )


def test_require_review_refuses_a_rejected_review_json(tmp_path: Path):
    write_pack(tmp_path, review_status="rejected")

    with pytest.raises(PublishError, match="approved review.json"):
        publish_pack(
            tmp_path,
            api_url="http://127.0.0.1:1",
            admin_token="unused",
            require_review=True,
        )


def test_published_import_refuses_a_rejected_review(tmp_path: Path):
    write_pack(tmp_path, review_status="rejected")

    with pytest.raises(PublishError, match="review status is 'rejected'"):
        publish_pack(
            tmp_path,
            api_url="http://127.0.0.1:1",
            admin_token="unused",
            publish=True,
        )


def test_a_rejected_review_can_still_be_imported_as_a_draft(tmp_path: Path):
    write_pack(tmp_path, review_status="rejected")

    # The review gate lets drafts through; it fails later on missing audio,
    # which proves the gate was passed rather than the import succeeding.
    with pytest.raises(PublishError, match="Missing local audio files"):
        publish_pack(
            tmp_path,
            api_url="http://127.0.0.1:1",
            admin_token="unused",
            publish=False,
        )
