import pytest
from pydantic import ValidationError

from listening_pipeline.models import Choice, LlmMcq, McqAnswer
from listening_pipeline.validate import validate_pack


def test_pack_serialises_to_camel_case_and_validates():
    from factories import test_pack

    pack = test_pack()
    data = pack.to_json()
    assert data["schemaVersion"] == 1
    assert data["durationSec"] == 600
    assert data["passages"][0]["topicCard"]["goalA"]
    assert data["passages"][0]["audio"]["durationSec"] == 95.5

    result = validate_pack(pack)
    assert not result.errors


def test_mcq_rejects_duplicate_choices():
    with pytest.raises(ValidationError):
        LlmMcq(
            type="mcq",
            prompt="Which platform?",
            choices=[
                Choice(key="a", text="Four"),
                Choice(key="b", text="Four"),
                Choice(key="c", text="Three"),
                Choice(key="d", text="Two"),
            ],
            answer=McqAnswer(key="a"),
            explanation="Maya says platform four.",
            skill="detail",
        )
