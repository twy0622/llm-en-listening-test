import { describe, expect, it } from "vitest";
import type { PassageRow, QuestionRow, TestRow } from "./rows";
import { toPublicTest } from "./exam";

describe("public exam payload", () => {
  const test: TestRow = {
    id: "test_1",
    title: "A short paper",
    level: "B1",
    accent: "mixed",
    duration_sec: 600,
    schema_version: 1,
    status: "published",
    season: "2026-Q4",
    archived_at: null,
    review_status: "approved",
    review_score: 92,
    review_notes: null,
    reviewed_at: "2026-10-20T00:00:00Z",
    created_at: "2026-10-20T00:00:00Z",
    published_at: "2026-10-20T00:00:00Z",
  };

  const passage: PassageRow = {
    id: "p_1",
    test_id: "test_1",
    position: 1,
    type: "dialogue",
    topic: "A platform change",
    transcript: "SECRET TRANSCRIPT",
    audio_key: "audio/test_1/p_1.mp3",
    audio_mime: "audio/mpeg",
    audio_duration_sec: 95.5,
    voice: null,
  };

  const question: QuestionRow = {
    id: "q_1",
    test_id: "test_1",
    passage_id: "p_1",
    position: 1,
    type: "mcq",
    prompt: "Which platform?",
    choices_json: JSON.stringify([
      { key: "a", text: "Two" },
      { key: "b", text: "Four" },
      { key: "c", text: "Five" },
      { key: "d", text: "Six" },
    ]),
    answer_json: JSON.stringify({ key: "b" }),
    explanation: "SECRET EXPLANATION",
    skill: "detail",
    points: 1,
  };

  it("never includes answers, explanations or transcripts", () => {
    const publicTest = toPublicTest({ test, passages: [passage], questions: [question] });
    const serialised = JSON.stringify(publicTest);
    expect(serialised).not.toContain("SECRET");
    expect(serialised).not.toContain("answer");
    expect(serialised).not.toContain("explanation");
    expect(publicTest.passages[0]?.questions[0]?.skill).toBe("detail");
    expect(publicTest.passages[0]?.audioUrl).toBe("/api/audio/audio/test_1/p_1.mp3");
  });
});
