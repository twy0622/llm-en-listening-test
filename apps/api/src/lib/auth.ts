import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { ApiError, forbidden, unauthorized } from "./errors";
import { constantTimeEqual, verifyToken, type AttemptClaims, type DeviceClaims } from "./tokens";

export const requireDevice: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header("x-device-token");
  const claims = await verifyToken<DeviceClaims>(c.env.ATTEMPT_SECRET, token);
  if (!claims || claims.k !== "device" || !claims.d) {
    throw unauthorized("A valid device token is required");
  }
  c.set("deviceId", claims.d);
  await next();
};

export const requireAttempt: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : c.req.header("x-attempt-token");

  const claims = await verifyToken<AttemptClaims>(c.env.ATTEMPT_SECRET, token);
  if (!claims || claims.k !== "attempt" || !claims.a) {
    throw unauthorized("A valid attempt token is required");
  }
  const attemptId = c.req.param("id");
  if (attemptId && claims.a !== attemptId) {
    throw forbidden("This attempt token does not belong to that attempt");
  }
  c.set("attemptId", claims.a);
  c.set("deviceId", claims.d);
  await next();
};

/**
 * Review endpoints accept either the attempt token (from the exam session) or
 * the device token (so history remains reviewable after a browser restart).
 */
export const requireAttemptOrDevice: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : c.req.header("x-attempt-token");

  const attemptClaims = await verifyToken<AttemptClaims>(c.env.ATTEMPT_SECRET, token);
  if (attemptClaims && attemptClaims.k === "attempt") {
    const attemptId = c.req.param("id");
    if (attemptId && attemptClaims.a !== attemptId) {
      throw forbidden("This attempt token does not belong to that attempt");
    }
    c.set("attemptId", attemptClaims.a);
    c.set("deviceId", attemptClaims.d);
    await next();
    return;
  }

  const deviceClaims = await verifyToken<DeviceClaims>(
    c.env.ATTEMPT_SECRET,
    c.req.header("x-device-token"),
  );
  if (!deviceClaims || deviceClaims.k !== "device") {
    throw unauthorized("A valid attempt or device token is required");
  }
  c.set("deviceId", deviceClaims.d);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const provided = c.req.header("x-admin-token") ?? "";
  if (!provided || !constantTimeEqual(provided, c.env.ADMIN_TOKEN)) {
    throw unauthorized("Invalid admin token");
  }
  await next();
};

export function assertOwner(ownerId: string, deviceId: string): void {
  if (ownerId !== deviceId) throw new ApiError(403, "This attempt belongs to another device", "forbidden");
}
