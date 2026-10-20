import { describe, expect, it } from "vitest";
import { isGapfillCorrect, normalizeAnswer } from "@listening/shared";

describe("answer normalisation", () => {
  it("ignores case, punctuation, curly quotes and whitespace", () => {
    expect(normalizeAnswer("  The  Manager’s   office. ")).toBe("the manager's office");
    expect(normalizeAnswer("“Platform 4”")).toBe("platform 4");
    expect(normalizeAnswer("7:40")).toBe("7 40");
    expect(normalizeAnswer("well—known")).toBe("well known");
  });

  it("accepts only listed gap-fill variants", () => {
    const accepted = ["colour", "color"];
    expect(isGapfillCorrect(" Colour! ", accepted)).toBe(true);
    expect(isGapfillCorrect("COLOR", accepted)).toBe(true);
    expect(isGapfillCorrect("colours", accepted)).toBe(false);
    expect(isGapfillCorrect("", accepted)).toBe(false);
  });
});
