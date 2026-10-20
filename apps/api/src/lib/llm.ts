import type { Env } from "../env";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResult {
  text: string;
  provider: string;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

function contentToString(content: OpenAiChatResponse["choices"]): string {
  const message = content?.[0]?.message?.content;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message.map((part) => part?.text ?? "").join("");
  }
  throw new Error("LLM returned no message content");
}

async function callOpenCode(
  env: Env,
  messages: LlmMessage[],
  maxTokens: number,
): Promise<string> {
  const base = (env.OPENCODE_BASE_URL ?? "https://opencode.ai").replace(/\/+$/, "");
  const model = env.OPENCODE_MODEL ?? "deepseek-v4.1-flash-free";
  const url = `${base}/inference/openai/v1/chat/completions`;

  const request = async (jsonMode: boolean): Promise<Response> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (env.OPENCODE_API_KEY) headers.authorization = `Bearer ${env.OPENCODE_API_KEY}`;
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    });
  };

  let response = await request(true);
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    // Not every free model accepts response_format; the prompt already demands
    // JSON, so retry once without it before falling back to another provider.
    response = await request(false);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenCode ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as OpenAiChatResponse;
  return contentToString(data.choices);
}

async function callWorkersAi(
  env: Env,
  messages: LlmMessage[],
  maxTokens: number,
): Promise<string> {
  const model = env.LLM_FALLBACK_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
  const output = (await env.AI.run(model as never, {
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
  } as never)) as unknown;

  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "response" in output) {
    const response = (output as { response?: unknown }).response;
    if (typeof response === "string") return response;
  }
  throw new Error("Workers AI returned no text");
}

/**
 * Provider chain: Workers AI first (free and in-account), then OpenCode only
 * when an API key is configured. OpenCode's free tier rejects external clients
 * by policy, so an unkeyed call would always waste a request. Grading callers
 * degrade to a deterministic heuristic if every provider fails.
 */
export async function complete(
  env: Env,
  messages: LlmMessage[],
  maxTokens = 900,
): Promise<LlmResult> {
  const errors: string[] = [];
  try {
    return { text: await callWorkersAi(env, messages, maxTokens), provider: "workers-ai" };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (env.OPENCODE_API_KEY) {
    try {
      return { text: await callOpenCode(env, messages, maxTokens), provider: "opencode" };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All LLM providers failed: ${errors.join(" | ")}`);
}

/** Extract the first JSON object from a model response (tolerates fences). */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
