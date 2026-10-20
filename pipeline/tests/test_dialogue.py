from listening_pipeline.validate import parse_dialogue_turns


def test_accepts_common_speaker_labels():
    turns, errors = parse_dialogue_turns(
        "**A:** Hello there.\nSpeaker B: Hi.\nA：Sorry, I mean the other one.\nB: Right."
    )
    assert not errors
    assert turns == [
        ("A", "Hello there."),
        ("B", "Hi."),
        ("A", "Sorry, I mean the other one."),
        ("B", "Right."),
    ]


def test_rejects_narrator_lines():
    _, errors = parse_dialogue_turns("A: Hello.\nThe waiter arrives.\nB: Thanks.")
    assert errors
    assert "not a clean A:/B: turn" in errors[0]


def test_rejects_empty_turn():
    _, errors = parse_dialogue_turns("A: Hello.\nB:   ")
    assert errors
