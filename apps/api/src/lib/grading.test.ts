import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { gradeItem } from "./grading";
import type { QuestionRow } from "./rows";

const env = {} as Env;

function question(overrides: Partial<QuestionRow>): QuestionRow {
  return {
    id: "q_1",
    test_id: "test_1",
    passage_id: "p_1",
    position: 1,
    type: "mcq",
    prompt: "Which platform?",
    choices_json: JSON.stringify([
      { key: "a", text: "Platform two" },
      { key: "b", text: "Platform four" },
      { key: "c", text: "Platform five" },
      { key: "d", text: "Platform six" },
    ]),
    answer_json: JSON.stringify({ key: "b" }),
    explanation: "Maya says platform four.",
    skill: "detail",
    points: 1,
    ...overrides,
  };
}

describe("exact grading", () => {
  it("accepts an MCQ key or the answer text", async () => {
    const row = question({});
    const byKey = await gradeItem(env, { question: row, response: " B ", transcript: "" });
    const byText = await gradeItem(env, {
      question: row,
      response: "platform four!",
      transcript: "",
    });
    expect(byKey.isCorrect).toBe(true);
    expect(byText.isCorrect).toBe(true);
    expect(byKey.gradedBy).toBe("exact");
  });

  it("rejects a wrong MCQ choice", async () => {
    const result = await gradeItem(env, { question: question({}), response: "c", transcript: "" });
    expect(result.isCorrect).toBe(false);
    expect(result.awarded).toBe(0);
  });

  it("normalises gap-fill punctuation and case", async () => {
    const row = question({
      type: "gapfill",
      choices_json: null,
      answer_json: JSON.stringify({ accepted: ["7:40", "seven forty"] }),
    });
    const result = await gradeItem(env, { question: row, response: " 7.40 ", transcript: "" });
    expect(result.isCorrect).toBe(true);
    expect(result.awarded).toBe(1);
  });

  it("explains the expected gap-fill answer when wrong", async () => {
    const row = question({
      type: "gapfill",
      choices_json: null,
      answer_json: JSON.stringify({ accepted: ["7:40"] }),
    });
    const result = await gradeItem(env, { question: row, response: "8:00", transcript: "" });
    expect(result.isCorrect).toBe(false);
    expect(result.feedback).toContain("7:40");
  });
});
