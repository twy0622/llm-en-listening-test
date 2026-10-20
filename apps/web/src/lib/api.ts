import type {
  AdminTest,
  AttemptResult,
  InProgressAttempt,
  Level,
  PublicTest,
  StartAttemptResponse,
  SubmitAttemptRequest,
  HistoryResponse,
} from "@listening/shared";
import {
  clearDeviceToken,
  getAdminToken,
  getAttemptToken,
  getDeviceToken,
  setDeviceToken,
} from "./storage";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "error",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: "device" | "none";
  attemptToken?: string;
  admin?: boolean;
  retry?: boolean;
}

let devicePromise: Promise<string> | null = null;

async function ensureDeviceToken(): Promise<string> {
  const existing = getDeviceToken();
  if (existing) return existing;
  if (!devicePromise) {
    devicePromise = fetch("/api/device", { method: "POST" })
      .then(async (response) => {
        const data = (await response.json()) as { token?: string; message?: string };
        if (!response.ok || !data.token) {
          throw new ApiClientError(
            response.status,
            data.message ?? "Could not create a device session",
            "device_failed",
          );
        }
        setDeviceToken(data.token);
        return data.token;
      })
      .finally(() => {
        devicePromise = null;
      });
  }
  return devicePromise;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" });
  const auth = options.auth ?? "device";

  if (auth === "device") {
    headers.set("x-device-token", await ensureDeviceToken());
  }
  if (options.attemptToken) headers.set("authorization", `Bearer ${options.attemptToken}`);
  if (options.admin) headers.set("x-admin-token", getAdminToken());

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { message?: string; error?: string; details?: unknown };
    if (
      response.status === 401 &&
      auth === "device" &&
      !options.retry &&
      !options.attemptToken &&
      !options.admin
    ) {
      clearDeviceToken();
      return request<T>(path, { ...options, retry: true });
    }
    throw new ApiClientError(
      response.status,
      payload.message ?? `Request failed (${response.status})`,
      payload.error ?? "request_failed",
      payload.details,
    );
  }

  return data as T;
}

export interface NextTestResponse {
  test: PublicTest;
  recommendedLevel: Level;
  requestedLevel: Level;
}

export function getNextTest(level: Level | "auto"): Promise<NextTestResponse> {
  return request<NextTestResponse>(`/api/tests/next?level=${encodeURIComponent(level)}`);
}

export async function startAttempt(testId: string): Promise<StartAttemptResponse> {
  return request<StartAttemptResponse>("/api/attempts", {
    method: "POST",
    body: { testId },
  });
}

export function submitAttempt(
  attemptId: string,
  token: string | null,
  answers: Record<string, string>,
): Promise<AttemptResult> {
  const body: SubmitAttemptRequest = {
    answers: Object.entries(answers).map(([questionId, response]) => ({ questionId, response })),
  };
  return request<AttemptResult>(`/api/attempts/${attemptId}/submit`, {
    method: "POST",
    body,
    attemptToken: token ?? undefined,
  });
}

export function getAttempt(
  attemptId: string,
  token?: string | null,
): Promise<AttemptResult | InProgressAttempt> {
  const attemptToken = token ?? getAttemptToken(attemptId) ?? undefined;
  return request<AttemptResult | InProgressAttempt>(`/api/attempts/${attemptId}`, {
    attemptToken,
  });
}

export function abandonAttempt(attemptId: string, token: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/attempts/${attemptId}/abandon`, {
    method: "POST",
    attemptToken: token,
  });
}

export function getHistory(): Promise<HistoryResponse> {
  return request<HistoryResponse>("/api/history");
}

export function adminListTests(): Promise<{ tests: AdminTest[] }> {
  return request<{ tests: AdminTest[] }>("/api/admin/tests", { auth: "none", admin: true });
}

export function adminSetPublished(testId: string, published: boolean): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/admin/tests/${testId}/publish`, {
    method: "POST",
    auth: "none",
    admin: true,
    body: { published },
  });
}

export function adminSetArchived(testId: string, archived: boolean): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/admin/tests/${testId}/archive`, {
    method: "POST",
    auth: "none",
    admin: true,
    body: { archived },
  });
}

export function adminDeleteTest(testId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/admin/tests/${testId}`, {
    method: "DELETE",
    auth: "none",
    admin: true,
  });
}
