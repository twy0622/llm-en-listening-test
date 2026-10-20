const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

function fromBase64Url(value: string): string {
  return decoder.decode(base64UrlToBytes(value));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface DeviceClaims {
  k: "device";
  d: string;
  exp: number;
}

export interface AttemptClaims {
  k: "attempt";
  d: string;
  a: string;
  exp: number;
}

export type Claims = DeviceClaims | AttemptClaims;

export async function signToken(secret: string, claims: Claims): Promise<string> {
  const payload = toBase64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken<T extends Claims>(
  secret: string,
  token: string | null | undefined,
): Promise<T | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  try {
    const expected = await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret),
      encoder.encode(payload),
    );
    const given = base64UrlToBytes(signature);
    if (!constantTimeEqualBytes(new Uint8Array(expected), given)) return null;
    const claims = JSON.parse(fromBase64Url(payload)) as T;
    if (!claims || typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  return constantTimeEqualBytes(encoder.encode(a), encoder.encode(b));
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function isoNow(): string {
  return new Date().toISOString();
}
