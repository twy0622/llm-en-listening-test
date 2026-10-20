import { Hono } from "hono";
import type { AppEnv } from "../env";
import { enforceRateLimit } from "../lib/http";
import { newId, signToken, unixNow } from "../lib/tokens";
import { z } from "zod";

const router = new Hono<AppEnv>();

const DeviceResponseSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  expiresAt: z.string(),
});

/**
 * Issues a signed, stateless device identity. The browser stores it in
 * localStorage; no account or cookie is required.
 */
router.post("/", async (c) => {
  await enforceRateLimit(c, "device", 30, 60);

  const deviceId = newId("dev");
  const exp = unixNow() + 2 * 365 * 24 * 60 * 60;
  const token = await signToken(c.env.ATTEMPT_SECRET, { k: "device", d: deviceId, exp });
  const response = { token, deviceId, expiresAt: new Date(exp * 1000).toISOString() };
  return c.json(DeviceResponseSchema.parse(response));
});

export default router;
