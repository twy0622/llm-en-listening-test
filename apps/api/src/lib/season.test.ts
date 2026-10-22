import { describe, expect, it } from "vitest";
import { formatSeason, seasonForDate } from "@listening/shared";

function utc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

describe("seasonForDate", () => {
  it.each([
    [utc(2026, 1, 1), "2026-Q1"],
    [utc(2026, 3, 31, 23, 59), "2026-Q1"],
    [utc(2026, 4, 1), "2026-Q2"],
    [utc(2026, 6, 30, 23, 59), "2026-Q2"],
    [utc(2026, 7, 1), "2026-Q3"],
    [utc(2026, 9, 30, 23, 59), "2026-Q3"],
    [utc(2026, 10, 1), "2026-Q4"],
    [utc(2026, 12, 31, 23, 59), "2026-Q4"],
  ])("maps %s to %s using UTC boundaries", (date, expected) => {
    expect(seasonForDate(date)).toBe(expected);
  });
});

describe("formatSeason", () => {
  it.each([
    [null, "Evergreen"],
    [undefined, "Evergreen"],
    ["evergreen", "Evergreen"],
    ["2026-Q1", "Winter 2026"],
    ["2026-Q2", "Spring 2026"],
    ["2026-Q3", "Summer 2026"],
    ["2026-Q4", "Autumn 2026"],
  ])("formats %s as %s", (season, expected) => {
    expect(formatSeason(season)).toBe(expected);
  });

  it("passes an unrecognised label through unchanged", () => {
    expect(formatSeason("legacy-pack")).toBe("legacy-pack");
  });
});
