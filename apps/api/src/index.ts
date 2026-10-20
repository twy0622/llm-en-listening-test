import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { ApiError } from "./lib/errors";
import { allowedOrigin } from "./lib/http";
import adminRoutes from "./routes/admin";
import attemptRoutes from "./routes/attempts";
import audioRoutes from "./routes/audio";
import deviceRoutes from "./routes/device";
import historyRoutes from "./routes/history";
import testRoutes from "./routes/tests";

const app = new Hono<AppEnv>();

const CORS_HEADERS = {
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, x-device-token, x-attempt-token, x-admin-token",
  "access-control-max-age": "86400",
};

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = allowedOrigin(origin, c.env.APP_ORIGIN);

  if (c.req.method === "OPTIONS") {
    if (origin && !allowed) {
      return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const headers = new Headers(CORS_HEADERS);
    if (origin) headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    return new Response(null, { status: 204, headers });
  }

  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  const started = Date.now();

  await next();

  c.header("x-request-id", requestId);
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "same-origin");
  if (origin && allowed) {
    c.header("access-control-allow-origin", origin);
    c.header("vary", "Origin");
    for (const [key, value] of Object.entries(CORS_HEADERS)) c.header(key, value);
  }
  console.log(
    JSON.stringify({
      event: "request",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    }),
  );
});

app.get("/api/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({
      ok: true,
      service: "all-ears",
      time: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      { ok: false, service: "all-ears", error: error instanceof Error ? error.message : "db error" },
      503,
    );
  }
});

app.route("/api/device", deviceRoutes);
app.route("/api/tests", testRoutes);
app.route("/api/attempts", attemptRoutes);
app.route("/api/history", historyRoutes);
app.route("/api/admin", adminRoutes);
app.route("/", audioRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "not_found", message: "Route not found" }, 404);
  }
  return c.text("Not found", 404);
});

app.onError((error, c) => {
  const requestId = c.get("requestId");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const origin = c.req.header("origin");
  if (origin && allowedOrigin(origin, c.env.APP_ORIGIN)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }

  if (error instanceof ApiError) {
    return new Response(
      JSON.stringify({
        error: error.code,
        message: error.message,
        details: error.details,
        requestId,
      }),
      { status: error.status, headers },
    );
  }

  console.error(
    JSON.stringify({
      event: "unhandled_error",
      requestId,
      path: c.req.path,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  return new Response(
    JSON.stringify({
      error: "internal_error",
      message: "Something went wrong. Please try again.",
      requestId,
    }),
    { status: 500, headers },
  );
});

async function cleanup(env: Env): Promise<void> {
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(dayAgo),
    env.DB.prepare("DELETE FROM attempts WHERE status = 'in_progress' AND deadline_at < ?").bind(weekAgo),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
