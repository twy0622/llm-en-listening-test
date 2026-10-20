from listening_pipeline.normalize import contains_answer, is_gapfill_correct, normalize_answer


def test_normalize_ignores_case_punctuation_and_curly_quotes():
    assert normalize_answer("  The  Manager’s   office. ") == "the manager's office"
    assert normalize_answer("“Platform 4”") == "platform 4"
    assert normalize_answer("7:40") == "7 40"
    assert normalize_answer("well-known") == "well-known"


def test_gapfill_accepts_spelling_variants_only():
    accepted = ["colour", "color"]
    assert is_gapfill_correct(" Colour! ", accepted)
    assert is_gapfill_correct("COLOR", accepted)
    assert not is_gapfill_correct("colours", accepted)
    assert not is_gapfill_correct("", accepted)


def test_contains_answer_uses_word_boundaries():
    transcript = "The next train leaves at 7:40 from platform four."
    assert contains_answer(transcript, "7:40")
    assert contains_answer(transcript, "platform four")
    assert not contains_answer(transcript, "platform five")
    assert not contains_answer(transcript, "plat")
