import { Hono } from "hono";
import { LevelSchema, type Level } from "@listening/shared";
import type { AppEnv } from "../env";
import { badRequest, notFound } from "../lib/errors";
import { loadTestContent, recommendLevel, toPublicTest } from "../lib/exam";
import { requireDevice } from "../lib/auth";
import { pickTest } from "../lib/selection";

const router = new Hono<AppEnv>();

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
