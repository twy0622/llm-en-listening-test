import { Hono } from "hono";
import type { HistoryResponse } from "@listening/shared";
import type { AppEnv } from "../env";
import { requireDevice } from "../lib/auth";
import { recommendLevel, skillTotalsForDevice } from "../lib/exam";
import type { HistoryItem } from "@listening/shared";

const router = new Hono<AppEnv>();

interface HistoryRow {
  attemptId: string;
  testId: string;
  title: string;
  level: string;
  startedAt: string;
  submittedAt: string | null;
  status: "in_progress" | "submitted";
  score: number | null;
  maxScore: number | null;
}

router.get("/", requireDevice, async (c) => {
  const deviceId = c.get("deviceId");
  const [rows, skills, recommendedLevel] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.id AS attemptId, a.test_id AS testId, t.title AS title, t.level AS level,
              a.started_at AS startedAt, a.submitted_at AS submittedAt, a.status AS status,
              a.score AS score, a.max_score AS maxScore
         FROM attempts a JOIN tests t ON t.id = a.test_id
        WHERE a.device_id = ?
        ORDER BY a.started_at DESC
        LIMIT 40`,
    )
      .bind(deviceId)
      .all<HistoryRow>(),
    skillTotalsForDevice(c.env, deviceId),
    recommendLevel(c.env, deviceId),
  ]);

  const attempts: HistoryItem[] = rows.results.map((row) => ({
    attemptId: row.attemptId,
    testId: row.testId,
    title: row.title,
    level: row.level as HistoryItem["level"],
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    status: row.status,
    score: row.score,
    maxScore: row.maxScore,
    percentage:
      row.score !== null && row.maxScore && row.maxScore > 0
        ? Math.round((row.score / row.maxScore) * 1000) / 10
        : null,
  }));

  const submitted = attempts.filter(
    (attempt) => attempt.status === "submitted" && attempt.percentage !== null,
  );
  const percentages = submitted.map((attempt) => attempt.percentage as number);
  const lastFive = percentages.slice(0, 5);

  const response: HistoryResponse = {
    deviceId,
    attempts,
    stats: {
      totalAttempts: submitted.length,
      averagePercentage:
        percentages.length === 0
          ? null
          : Math.round((percentages.reduce((a, b) => a + b, 0) / percentages.length) * 10) / 10,
      bestPercentage: percentages.length === 0 ? null : Math.max(...percentages),
      lastFiveAverage:
        lastFive.length === 0
          ? null
          : Math.round((lastFive.reduce((a, b) => a + b, 0) / lastFive.length) * 10) / 10,
    },
    skills,
    recommendedLevel,
  };

  return c.json(response);
});

export default router;
