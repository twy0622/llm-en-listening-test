import type { Context } from "hono";
import type { ZodType } from "zod";
import type { AppEnv } from "../env";
import { badRequest, tooMany } from "./errors";
import { sha256Hex } from "./tokens";

export async function parseJsonBody<T>(
  c: Context<AppEnv>,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw badRequest("Request validation failed", details);
  }
  return result.data;
}

export async function enforceRateLimit(
  c: Context<AppEnv>,
  route: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  const key = await sha256Hex(`${route}:${ip}`);
  const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;

  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start
                    THEN rate_limits.count + 1 ELSE 1 END,
       window_start = CASE WHEN rate_limits.window_start = excluded.window_start
                           THEN rate_limits.window_start ELSE excluded.window_start END
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();

  if (row && row.count > limit) {
    throw tooMany("Too many requests. Please wait a moment and try again.");
  }
}

export function allowedOrigin(origin: string | undefined, configured: string | undefined): boolean {
  if (!origin) return false;
  const allowlist = (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowlist.includes(origin)) return true;
  return /^http:\/\/localhost(:\d+)?$/.test(origin);
}
