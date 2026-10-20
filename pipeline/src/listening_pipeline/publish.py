from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from .models import PackReview, TestPack


class PublishError(RuntimeError):
    pass


@dataclass
class PublishResult:
    test_id: str
    status: str
    questions: int
    audio_files: int


def load_pack(pack_dir: Path) -> TestPack:
    path = pack_dir / "test.json"
    if not path.exists():
        raise PublishError(f"No test.json found in {pack_dir}")
    pack = TestPack.model_validate_json(path.read_text(encoding="utf-8"))

    review_path = pack_dir / "review.json"
    if review_path.exists():
        try:
            review = PackReview.model_validate_json(review_path.read_text(encoding="utf-8"))
        except ValueError as error:
            raise PublishError(f"Invalid review.json: {error}") from error
        pack = pack.model_copy(update={"review": review})
    return pack


def publish_pack(
    pack_dir: Path,
    *,
    api_url: str,
    admin_token: str,
    publish: bool = True,
    replace: bool = False,
    require_review: bool = False,
    timeout: float = 180,
) -> PublishResult:
    pack = load_pack(pack_dir)
    if require_review and (not pack.review or pack.review.status != "approved"):
        raise PublishError("This pack needs an approved review.json before it can be published")
    if publish and pack.review and pack.review.status != "approved":
        raise PublishError(
            f"This pack's review status is {pack.review.status!r}; import it as a draft or fix it"
        )
    audio_dir = pack_dir / "audio"
    uploads = []
    missing: list[str] = []

    for passage in pack.passages:
        local = audio_dir / Path(passage.audio.key).name
        if not local.exists():
            missing.append(str(local))
            continue
        uploads.append(
            {
                "key": passage.audio.key,
                "mime": passage.audio.mime,
                "dataBase64": base64.b64encode(local.read_bytes()).decode("ascii"),
            }
        )

    if missing:
        raise PublishError("Missing local audio files:\n- " + "\n- ".join(missing))

    payload = {
        "test": pack.to_json(),
        "audio": uploads,
        "publish": publish,
        "replace": replace,
    }

    url = api_url.rstrip("/") + "/api/admin/import"
    try:
        response = httpx.post(
            url,
            headers={"x-admin-token": admin_token, "content-type": "application/json"},
            content=json.dumps(payload),
            timeout=timeout,
        )
    except httpx.HTTPError as error:
        raise PublishError(f"Could not reach {url}: {error}") from error

    if response.status_code >= 400:
        detail = response.text[:800]
        try:
            data = response.json()
            detail = data.get("message", detail)
            if data.get("details"):
                detail += " " + json.dumps(data["details"])
        except ValueError:
            pass
        raise PublishError(f"Import failed ({response.status_code}): {detail}")

    data = response.json()
    return PublishResult(
        test_id=str(data.get("testId", pack.id)),
        status=str(data.get("status", "draft")),
        questions=int(data.get("questions", 0)),
        audio_files=int(data.get("audioFiles", len(uploads))),
    )
