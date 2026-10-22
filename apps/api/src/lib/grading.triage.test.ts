import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import type { QuestionRow } from "./rows";

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return { ...actual, complete: vi.fn() };
});

import { gradeItem } from "./grading";
import { complete } from "./llm";

const completeMock = vi.mocked(complete);
const env = {} as Env;

const expected = "Remote work reduces commuting costs";
const rubric = ["flexibility", "office"];

function subjective(): QuestionRow {
  return {
    id: "q_short",
    test_id: "test_1",
    passage_id: "p_1",
    position: 5,
    type: "subjective",
    prompt: "What is the speaker's view of remote work?",
    choices_json: null,
    answer_json: JSON.stringify({ expected, rubric }),
    explanation: "The speaker mentions commuting costs and flexibility.",
    skill: "inference",
    points: 1,
  };
}

async function grade(response: string) {
  return gradeItem(env, { question: subjective(), response, transcript: "unused" });
}

describe("short-answer triage", () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it("grades a clear full answer without calling a model", async () => {
    const result = await grade(
      "Remote work reduces commuting costs and gives people more flexibility.",
    );

    expect(completeMock).not.toHaveBeenCalled();
    expect(result.gradedBy).toBe("heuristic");
    expect(result.awarded).toBe(1);
  });

  it("grades an off-topic answer without calling a model", async () => {
    const result = await grade("I really enjoy blue cheese and long mountain walks.");

    expect(completeMock).not.toHaveBeenCalled();
    expect(result.gradedBy).toBe("heuristic");
    expect(result.awarded).toBe(0);
  });

  it("rejects a too-short answer without calling a model", async () => {
    const result = await grade("No idea");

    expect(completeMock).not.toHaveBeenCalled();
    expect(result.gradedBy).toBe("heuristic");
    expect(result.awarded).toBe(0);
  });

  it("asks the model only for a genuinely ambiguous answer", async () => {
    completeMock.mockResolvedValue({
      text: '{"score": 0.5, "feedback": "Partly relevant, but misses the main point."}',
      provider: "test",
    });

    // Matches "office" and "flexibility" out of seven content keywords: low, but
    // not low enough for the deterministic zero branch.
    const result = await grade(
      "The office might be useful for flexibility when people need to meet.",
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.gradedBy).toBe("llm");
    expect(result.awarded).toBe(0.5);
    expect(result.feedback).toContain("Partly relevant");
  });

  it("falls back to the heuristic when the model returns an unusable score", async () => {
    completeMock.mockResolvedValue({
      text: '{"feedback": "No score here."}',
      provider: "test",
    });

    const result = await grade(
      "The office might be useful for flexibility when people need to meet.",
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.gradedBy).toBe("heuristic");
    expect(result.awarded).toBe(0.5);
  });
});
