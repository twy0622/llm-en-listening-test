import { Hono } from "hono";
import type { AppEnv } from "../env";
import { notFound } from "../lib/errors";

const router = new Hono<AppEnv>();

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*\.(mp3|wav|ogg)$/;

function objectKey(path: string): string | null {
  const prefix = "/api/audio/";
  const index = path.indexOf(prefix);
  if (index === -1) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(path.slice(index + prefix.length));
  } catch {
    return null;
  }
  if (!SAFE_KEY.test(raw) || raw.includes("..") || raw.startsWith("/")) return null;
  return raw;
}

function baseHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

router.get("/api/audio/*", async (c) => {
  const key = objectKey(c.req.path);
  if (!key) throw notFound("Audio not found");

  const range = c.req.header("range");
  const object = await c.env.AUDIO.get(key, range ? { range: c.req.raw.headers } : undefined);
  if (!object) throw notFound("Audio not found");

  const headers = baseHeaders(object);
  const selectedRange = object.range;
  if (range && selectedRange) {
    let start: number | undefined;
    let length: number | undefined;
    if ("offset" in selectedRange) {
      start = selectedRange.offset;
      length = selectedRange.length;
    } else if ("suffix" in selectedRange) {
      length = Math.min(selectedRange.suffix, object.size);
      start = object.size - length;
    }
    if (typeof start === "number" && typeof length === "number" && length > 0) {
      headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
});

router.on(["HEAD"], "/api/audio/*", async (c) => {
  const key = objectKey(c.req.path);
  if (!key) throw notFound("Audio not found");
  const object = await c.env.AUDIO.head(key);
  if (!object) throw notFound("Audio not found");
  const headers = baseHeaders(object);
  headers.set("content-length", String(object.size));
  return new Response(null, { status: 200, headers });
});

export default router;
