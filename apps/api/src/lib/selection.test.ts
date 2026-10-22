import { describe, expect, it } from "vitest";
// @ts-ignore -- Node's module helper is available in the test runtime.
import { createRequire } from "node:module";
import { pickTest, type SelectionDatabase } from "./selection";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => unknown;
};

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): void;
    get(...values: unknown[]): unknown;
  };
};

/**
 * Adapt Node's synchronous SQLite to the tiny async D1 surface used by
 * `pickTest`, so the tests execute the real selection SQL.
 */
function selectionDatabase(db: Sqlite): SelectionDatabase {
  return {
    prepare(query: string) {
      const statement = db.prepare(query);
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              return (statement.get(...values) ?? null) as T | null;
            },
          };
        },
      };
    },
  };
}

const SEASON = "2026-Q4";

function createDatabase(): Sqlite {
  const db = new DatabaseSync(":memory:") as unknown as Sqlite;
  db.exec(`
    CREATE TABLE tests (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      status TEXT NOT NULL,
      season TEXT,
      archived_at TEXT
    );
    CREATE TABLE attempts (
      test_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  return db;
}

function addTest(
  db: Sqlite,
  id: string,
  options: {
    level?: string;
    season?: string | null;
    status?: "published" | "draft";
    archived?: boolean;
  } = {},
): void {
  db.prepare(
    `INSERT INTO tests (id, level, status, season, archived_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.level ?? "B1",
    options.status ?? "published",
    options.season === undefined ? SEASON : options.season,
    options.archived ? "2026-10-20T00:00:00Z" : null,
  );
}

function submit(db: Sqlite, deviceId: string, testId: string): void {
  db.prepare(`INSERT INTO attempts (test_id, device_id, status) VALUES (?, ?, 'submitted')`).run(
    testId,
    deviceId,
  );
}

function asSelection(db: Sqlite): SelectionDatabase {
  return selectionDatabase(db);
}

describe("paper selection", () => {
  it("prefers the current season within the requested level", async () => {
    const db = createDatabase();
    addTest(db, "test_current", { season: "2026-Q4" });
    addTest(db, "test_old", { season: "2025-Q4" });

    expect(await pickTest(asSelection(db), "dev_1", "B1", SEASON)).toBe("test_current");
  });

  it("does not serve a paper the device has already submitted", async () => {
    const db = createDatabase();
    addTest(db, "test_a");
    addTest(db, "test_b");
    submit(db, "dev_1", "test_a");

    expect(await pickTest(asSelection(db), "dev_1", "B1", SEASON)).toBe("test_b");
  });

  it("serves an unseen older paper before repeating a seen current one", async () => {
    const db = createDatabase();
    addTest(db, "test_current", { season: "2026-Q4" });
    addTest(db, "test_old", { season: "2025-Q4" });
    submit(db, "dev_1", "test_current");

    expect(await pickTest(asSelection(db), "dev_1", "B1", SEASON)).toBe("test_old");
  });

  it("serves a repeat when every eligible paper has been seen", async () => {
    const db = createDatabase();
    addTest(db, "test_a");
    addTest(db, "test_b");
    submit(db, "dev_1", "test_a");
    submit(db, "dev_1", "test_b");

    const picked = await pickTest(asSelection(db), "dev_1", "B1", SEASON);
    expect(["test_a", "test_b"]).toContain(picked);
  });

  it("never serves archived or draft papers", async () => {
    const db = createDatabase();
    addTest(db, "test_archived", { archived: true });
    addTest(db, "test_draft", { status: "draft" });

    expect(await pickTest(asSelection(db), "dev_1", "B1", SEASON)).toBeNull();
  });

  it("respects the requested level and leaves the cross-level fallback to the route", async () => {
    const db = createDatabase();
    addTest(db, "test_b1", { level: "B1" });

    expect(await pickTest(asSelection(db), "dev_1", "C1", SEASON)).toBeNull();
  });

  it("can exclude seen papers across all levels for the route's fallback", async () => {
    const db = createDatabase();
    addTest(db, "test_b1", { level: "B1" });
    addTest(db, "test_b2", { level: "B2" });
    submit(db, "dev_1", "test_b1");

    expect(await pickTest(asSelection(db), "dev_1", null, SEASON)).toBe("test_b2");
  });
});
