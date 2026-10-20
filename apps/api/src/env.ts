export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;

  /** HMAC key for device and attempt tokens. */
  ATTEMPT_SECRET: string;
  /** Shared secret for the content factory's import endpoint. */
  ADMIN_TOKEN: string;

  APP_ORIGIN?: string;
  OPENCODE_BASE_URL?: string;
  OPENCODE_MODEL?: string;
  OPENCODE_API_KEY?: string;
  LLM_FALLBACK_MODEL?: string;
}

export interface Variables {
  requestId: string;
  deviceId: string;
  attemptId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};
