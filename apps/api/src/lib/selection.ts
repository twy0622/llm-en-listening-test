import { seasonForDate, type Level } from "@listening/shared";

/**
 * The small slice of D1 that selection needs. Keeping it structural lets the
 * route pass `c.env.DB` unchanged while tests can run the same SQL against a
 * real SQLite database.
 */
export interface SelectionDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
}

function buildParams(level: Level | null, deviceId: string, season: string): unknown[] {
  return level ? [level, deviceId, season] : [deviceId, season];
}

/**
 * Pick the next paper for a device.
 *
 * - published and not archived only;
 * - the requested level when given;
 * - papers already submitted by this device are skipped while unseen ones
 *   remain;
 * - the current season is preferred, but an unseen older paper still beats a
 *   repeat;
 * - once every eligible paper has been seen, serve a repeat rather than an
 *   empty screen.
 */
export async function pickTest(
  db: SelectionDatabase,
  deviceId: string,
  level: Level | null,
  season: string = seasonForDate(),
): Promise<string | null> {
  const levelClause = level ? "AND level = ?" : "";

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
    .bind(...buildParams(level, deviceId, season))
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
