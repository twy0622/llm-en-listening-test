from __future__ import annotations

from listening_pipeline.models import (
    AudioRef,
    Choice,
    GapfillAnswer,
    LlmGapfill,
    LlmMcq,
    LlmSubjective,
    McqAnswer,
    RawPassage,
    SubjectiveAnswer,
    TopicCard,
)

TRANSCRIPT = (
    "Maya: The next train leaves at 7:40 from platform four, so we should leave now.\n"
    "Jonah: Right. I'll grab the blue folder and meet you by the ticket machine.\n"
    "Maya: Sorry, I mean platform three — the board just changed.\n"
    "Jonah: Then we need to move. Do we still have time for coffee?\n"
    "Maya: Not if you want to catch the connection. The wedding starts at noon.\n"
    "Jonah: Fine. I'll text the others and tell them to go straight to the station.\n"
    "Maya: Good. And can you check whether the 7:40 is running late?\n"
    "Jonah: I'll look now. If it is, we can take the bus instead.\n"
)


def topic_card(level: str = "B1") -> TopicCard:
    return TopicCard(
        id="top_123456789abc",
        kind="dialogue",
        domain="travel",
        relationship="two friends planning a trip",
        setting="a busy ticket hall",
        goalA="catch a connection",
        goalB="decide whether to wait for a delayed coach",
        obstacle="the platform changed at the last minute",
        stakes="a wedding starts at noon",
        register="friendly but hurried",
        level=level,
        details=["platform 4", "a blue folder", "the 7:40 train"],
    )


def raw_passage() -> RawPassage:
    return RawPassage(
        title="The Platform Change",
        topic="Two friends reorganise their journey after a platform change.",
        transcript=TRANSCRIPT,
        gender=None,
        questions=[
            LlmMcq(
                type="mcq",
                prompt="What time does the next train leave?",
                choices=[
                    Choice(key="a", text="7:14"),
                    Choice(key="b", text="7:40"),
                    Choice(key="c", text="8:00"),
                    Choice(key="d", text="8:40"),
                ],
                answer=McqAnswer(key="b"),
                explanation="Maya says the next train leaves at 7:40.",
                skill="detail",
            ),
            LlmGapfill(
                type="gapfill",
                prompt="Jonah will grab the ___ and meet Maya by the ticket machine.",
                answer=GapfillAnswer(accepted=["blue folder"]),
                explanation="Jonah says he will grab the blue folder.",
                skill="vocabulary",
            ),
            LlmMcq(
                type="mcq",
                prompt="Why does Maya want to leave immediately?",
                choices=[
                    Choice(key="a", text="She is worried about missing the connection."),
                    Choice(key="b", text="She wants to buy coffee before the journey."),
                    Choice(key="c", text="She has lost her ticket."),
                    Choice(key="d", text="She wants to meet the others at the station."),
                ],
                answer=McqAnswer(key="a"),
                explanation="She says there is no time for coffee if they want the connection.",
                skill="inference",
            ),
            LlmGapfill(
                type="gapfill",
                prompt="The wedding starts at ___.",
                answer=GapfillAnswer(accepted=["noon", "12:00", "twelve"]),
                explanation="Maya says the wedding starts at noon.",
                skill="detail",
            ),
            LlmSubjective(
                type="subjective",
                prompt="What does Maya imply about the journey?",
                answer=SubjectiveAnswer(
                    expected=(
                        "Maya thinks the connection is tight and they should leave immediately. "
                        "She is worried that stopping for coffee could make them late for the wedding."
                    ),
                    rubric=[
                        "Mentions that time is short or the connection is tight",
                        "Mentions the wedding or arriving on time",
                    ],
                ),
                explanation="Maya contrasts coffee with catching the connection and the noon wedding.",
                skill="attitude",
            ),
        ],
    )


def passage_pack():
    from listening_pipeline.generation import to_pack_questions
    from listening_pipeline.models import PassagePack

    raw = raw_passage()
    return PassagePack(
        id="p_123456789abc",
        position=1,
        type="dialogue",
        topic=raw.topic,
        transcript=raw.transcript,
        audio=AudioRef(
            key="audio/test_abcdef123456/p_123456789abc.mp3",
            mime="audio/mpeg",
            durationSec=95.5,
        ),
        topicCard=topic_card(),
        questions=to_pack_questions(raw, "p_123456789abc"),
    )


def test_pack():
    from listening_pipeline.models import TestPack

    return TestPack(
        schemaVersion=1,
        id="test_abcdef123456",
        title="The Platform Change",
        level="B1",
        accent="mixed",
        durationSec=600,
        createdAt="2026-10-20T00:00:00Z",
        passages=[passage_pack()],
    )
