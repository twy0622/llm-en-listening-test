import type { Level, PublicTest } from "@listening/shared";

const DEVICE_KEY = "ae.deviceToken";
const ACTIVE_KEY = "ae.activeAttempt";
const PREFERRED_LEVEL_KEY = "ae.preferredLevel";
const ADMIN_KEY = "ae.adminToken";
const ATTEMPT_PREFIX = "ae.attempt.";
const DRAFT_PREFIX = "ae.draft.";

export interface ActiveAttempt {
  attemptId: string;
  token: string;
  startedAt: string;
  deadlineAt: string;
  test: PublicTest;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private modes; the app still works in-memory.
  }
}

function read<T>(key: string): T | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // A cyclic/value error should not break the exam UI.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getDeviceToken(): string | null {
  return readRaw(DEVICE_KEY);
}

export function setDeviceToken(token: string): void {
  writeRaw(DEVICE_KEY, token);
}

export function clearDeviceToken(): void {
  remove(DEVICE_KEY);
}

export function getActiveAttempt(): ActiveAttempt | null {
  return read<ActiveAttempt>(ACTIVE_KEY);
}

export function setActiveAttempt(attempt: ActiveAttempt): void {
  write(ACTIVE_KEY, attempt);
  saveAttemptToken(attempt.attemptId, attempt.token);
}

export function clearActiveAttempt(): void {
  remove(ACTIVE_KEY);
}

export function isExpired(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

export function saveAttemptToken(attemptId: string, token: string): void {
  writeRaw(`${ATTEMPT_PREFIX}${attemptId}`, token);
}

export function getAttemptToken(attemptId: string): string | null {
  return readRaw(`${ATTEMPT_PREFIX}${attemptId}`);
}

export function getDraft(attemptId: string): Record<string, string> {
  return read<Record<string, string>>(`${DRAFT_PREFIX}${attemptId}`) ?? {};
}

export function saveDraft(attemptId: string, answers: Record<string, string>): void {
  write(`${DRAFT_PREFIX}${attemptId}`, answers);
}

export function clearDraft(attemptId: string): void {
  remove(`${DRAFT_PREFIX}${attemptId}`);
}

export function getPreferredLevel(): Level | "auto" {
  const value = readRaw(PREFERRED_LEVEL_KEY);
  if (value === "A2" || value === "B1" || value === "B2" || value === "C1" || value === "auto") {
    return value;
  }
  return "auto";
}

export function setPreferredLevel(level: Level | "auto"): void {
  writeRaw(PREFERRED_LEVEL_KEY, level);
}

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY, token);
  } catch {
    // The admin page can still be used for this tab if session storage is blocked.
  }
}
