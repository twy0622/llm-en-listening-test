import { Hono } from "hono";
import { LevelSchema, seasonForDate, type Level } from "@listening/shared";
import type { AppEnv } from "../env";
import { badRequest, notFound } from "../lib/errors";
import { loadTestContent, recommendLevel, toPublicTest } from "../lib/exam";
import { requireDevice } from "../lib/auth";

const router = new Hono<AppEnv>();

async function pickTest(
  db: D1Database,
  deviceId: string,
  level: Level | null,
): Promise<string | null> {
  const season = seasonForDate();
  const levelClause = level ? "AND level = ?" : "";
  const baseParams: unknown[] = [];
  if (level) baseParams.push(level);
  baseParams.push(deviceId, season);

  const withExclusion = await db
    .prepare(
      `SELECT id FROM tests
        WHERE status = 'published' AND archived_at IS NULL ${levelClause}
          AND id NOT IN (
            SELECT test_id FROM attempts
             WHERE device_id = ? AND status = 'submitted'
          )
        ORDER BY CASE WHEN season = ? THEN 0 ELSE 1 END, RANDOM()
        LIMIT 1`,
    )
    .bind(...baseParams)
    .first<{ id: string }>();

  if (withExclusion) return withExclusion.id;

  // Once a learner has seen the whole shelf, serve a repeat rather than an
  // empty screen. Archived papers never re-enter the rotation.
  const fallback = await db
    .prepare(
      `SELECT id FROM tests
        WHERE status = 'published' AND archived_at IS NULL ${levelClause}
        ORDER BY CASE WHEN season = ? THEN 0 ELSE 1 END, RANDOM()
        LIMIT 1`,
    )
    .bind(...(level ? [level, season] : [season]))
    .first<{ id: string }>();
  return fallback?.id ?? null;
}

router.get("/next", requireDevice, async (c) => {
  const requested = c.req.query("level");
  let level: Level | null = null;

  if (requested && requested !== "auto") {
    const parsed = LevelSchema.safeParse(requested);
    if (!parsed.success) throw badRequest("level must be one of A2, B1, B2, C1, or auto");
    level = parsed.data;
  }

  const recommended = await recommendLevel(c.env, c.get("deviceId"));
  const target = level ?? recommended;
  let testId = await pickTest(c.env.DB, c.get("deviceId"), target);

  // Auto can recommend a level that has no published paper yet. Serve the
  // closest available paper instead of dead-ending the learner.
  if (!testId) testId = await pickTest(c.env.DB, c.get("deviceId"), null);

  if (!testId) {
    throw notFound("No published tests are available yet. Run the content factory and import a pack.");
  }

  const content = await loadTestContent(c.env, testId);
  if (!content) throw notFound("Test not found");

  return c.json({
    test: toPublicTest(content),
    recommendedLevel: recommended,
    requestedLevel: target,
  });
});

export default router;
