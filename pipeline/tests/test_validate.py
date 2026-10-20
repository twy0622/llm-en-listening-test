from listening_pipeline.models import GapfillAnswer, LlmGapfill
from listening_pipeline.validate import _check_common_text, _validate_question, validate_raw_passage


def test_gapfill_answer_must_appear_in_transcript():
    question = LlmGapfill(
        type="gapfill",
        prompt="The train leaves at ___.",
        answer=GapfillAnswer(accepted=["7:45"]),
        explanation="The time is stated by Maya.",
        skill="detail",
    )
    errors = _validate_question(question, "The train leaves at 7:40.", 1)
    assert any("does not appear" in error for error in errors)


def test_gapfill_answer_cannot_be_printed_in_prompt():
    question = LlmGapfill(
        type="gapfill",
        prompt="The train leaves at 7:40, not ___.",
        answer=GapfillAnswer(accepted=["7:40"]),
        explanation="The time is stated by Maya.",
        skill="detail",
    )
    errors = _validate_question(question, "The train leaves at 7:40.", 1)
    assert any("printed in the prompt" in error for error in errors)


def test_banned_content_is_rejected():
    errors = _check_common_text("They argued about the election on the radio.", "Transcript")
    assert any("sensitive" in error for error in errors)


def test_dialogue_must_alternate():
    from factories import raw_passage, topic_card

    raw = raw_passage()
    raw.transcript = "A: Hello.\nA: Are you there?\nB: Yes.\nA: Good.\nB: Right.\nA: Okay."
    result = validate_raw_passage(raw, topic_card(), "B1")
    assert any("alternate" in error for error in result.errors)


def test_monologue_rejects_speaker_labels():
    from factories import raw_passage, topic_card

    raw = raw_passage()
    card = topic_card()
    card.kind = "monologue"
    raw.transcript = "A: This is a monologue.\nB: No, it is not."
    result = validate_raw_passage(raw, card, "B1")
    assert any("speaker labels" in error for error in result.errors)
