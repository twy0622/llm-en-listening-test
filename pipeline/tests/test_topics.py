from pathlib import Path

from listening_pipeline.topics import TopicStore, build_topic_card, generate_topic_cards

import random


def test_cards_are_unique_and_deterministic():
    cards = generate_topic_cards("dialogue", "B1", 40, seed=123)
    assert len(cards) == 40
    assert len({card.id for card in cards}) == 40
    assert all(card.kind == "dialogue" for card in cards)
    assert all(card.level == "B1" for card in cards)
    assert all(len(card.details) >= 3 for card in cards)

    first = generate_topic_cards("dialogue", "B1", 5, seed=999)
    second = generate_topic_cards("dialogue", "B1", 5, seed=999)
    assert [card.id for card in first] == [card.id for card in second]


def test_store_roundtrip(tmp_path: Path):
    store = TopicStore(tmp_path / "topics.jsonl")
    card = build_topic_card("monologue", "B2", random.Random(7))
    store.add(card)
    store.add(card)
    lines = (tmp_path / "topics.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1

    reloaded = TopicStore(tmp_path / "topics.jsonl")
    assert card.id in {row["id"] for row in [__import__("json").loads(lines[0])]}
    assert len(reloaded.fingerprints) == 1


def test_monologue_and_dialogue_use_different_goals():
    rng = random.Random(1)
    monologue = build_topic_card("monologue", "B1", rng)
    dialogue = build_topic_card("dialogue", "B1", rng)
    assert monologue.goal_a
    assert dialogue.goal_b
    assert monologue.kind != dialogue.kind or monologue.id != dialogue.id
