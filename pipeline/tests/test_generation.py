from listening_pipeline.generation import to_pack_questions
from listening_pipeline.prompts import build_writer_messages, WORD_TARGETS
from listening_pipeline.providers import JsonParseError, extract_json_object

import pytest


def test_question_conversion_assigns_ids_and_positions():
    from factories import raw_passage

    questions = to_pack_questions(raw_passage(), "p_123456789abc")
    assert [q.type for q in questions] == ["mcq", "gapfill", "mcq", "gapfill", "subjective"]
    assert [q.position for q in questions] == [1, 2, 3, 4, 5]
    assert len({q.id for q in questions}) == 5
    assert all(q.points == 1 for q in questions)


def test_prompt_includes_card_and_replaces_placeholders():
    from factories import topic_card

    card = topic_card()
    messages = build_writer_messages(card, "B1", "uk")
    text = messages[-1]["content"]
    assert card.setting in text
    assert "{{" not in text
    minimum, maximum = WORD_TARGETS["dialogue"]["B1"]
    assert f"{minimum}–{maximum}" in text
    assert "British English" in text


def test_extract_json_from_fence_and_prose():
    parsed = extract_json_object('Here you go:\n```json\n{"score": 1, "note": "ok"}\n```\n')
    assert parsed["score"] == 1

    parsed = extract_json_object('{"a": {"b": 2}} trailing text')
    assert parsed["a"]["b"] == 2


def test_extract_json_rejects_non_json():
    with pytest.raises(JsonParseError):
        extract_json_object("No object here")
