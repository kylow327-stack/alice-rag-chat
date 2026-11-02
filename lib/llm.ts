/**
 * Multi-provider LLM cascade.
 *
 * Tries providers in order: DeepSeek → Groq → OpenRouter.
 * All three are OpenAI-compatible (same /chat/completions body shape),
 * so a single request function works for all of them.
 *
 * Provider rotation solves the problem that killed the demo on OpenRouter
 * alone: OpenRouter's free tier is rate-limited at 50 requests/day (shared
 * across all free models). DeepSeek is a paid API but extremely cheap
 * ($0.14/M input, $0.28/M output — ~$0.0002 per answer), so it never
 * rate-limits. Groq gives 30 RPM / 1,000 RPD on the free tier as a fallback.
 */

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  DEEPSEEK_CHAT_URL,
  DEEPSEEK_MODEL,
  GROQ_CHAT_URL,
  GROQ_MODEL,
  OPENROUTER_ALL_MODELS,
  OPENROUTER_CHAT_URL,
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MODEL,
  OPENROUTER_REFERER,
  OPENROUTER_RETRY2_FALLBACKS,
  OPENROUTER_RETRY2_MODEL,
  OPENROUTER_RETRY3_FALLBACKS,
  OPENROUTER_RETRY3_MODEL,
  OPENROUTER_RETRY_FALLBACKS,
  OPENROUTER_RETRY_MODEL,
  OPENROUTER_TITLE,
  REQUEST_TIMEOUT_MS,
} from "./constants";
import { answerFromPayload, answerFromReasoning } from "./extract-answer";
import type { ModelMessage } from "./types";

// ─── Public API (same surface as the old openrouter.ts) ────────────────────

export class LLMError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LLMError";
    this.status = status;
  }
}

/** Backward-compatible alias for existing imports. */
export const OpenRouterError = LLMError;

export function llmConfigError(): string | null {
  const deepseek = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  const groq = process.env.GROQ_API_KEY?.trim() ?? "";
  const openrouter = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!deepseek && !groq && !openrouter) {
    return "No LLM API key is configured. Set DEEPSEEK_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.";
  }
  return null;
}

/** Backward-compatible alias. */
export const openRouterConfigError = llmConfigError;

// ─── OpenRouter free-model guard (unchanged) ───────────────────────────────

export function assertFreeChatModels(ids: readonly string[]): void {
  if (ids.length === 0 || ids.length > 3) {
    throw new LLMError(500, "Refusing to call an OpenRouter model that is not on the free tier.");
  }
  for (const id of ids) {
    if (!id.endsWith(":free")) {
      throw new LLMError(500, "Refusing to call an OpenRouter model that is not on the free tier.");
    }
  }
}

export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status === 503 || status === 404 || status < 400;
}

// ─── Provider definitions ──────────────────────────────────────────────────

type Provider = {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  /** Extra OpenRouter "models" array entries (OpenRouter only). */
  fallbackModels?: readonly string[];
  /** Extra headers (OpenRouter referer/title). */
  extraHeaders?: Record<string, string>;
};

function availableProviders(): Provider[] {
  const providers: Provider[] = [];

  // 1. DeepSeek (primary — extremely cheap paid API, effectively no rate limit)
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  if (deepseekKey) {
    providers.push({
      name: "DeepSeek",
      url: DEEPSEEK_CHAT_URL,
      apiKey: deepseekKey,
      model: DEEPSEEK_MODEL,
    });
  }

  // 2. Groq (secondary — fast LPU inference, 30 RPM / 1000 RPD free tier)
  const groqKey = process.env.GROQ_API_KEY?.trim() ?? "";
  if (groqKey) {
    providers.push({
      name: "Groq",
      url: GROQ_CHAT_URL,
      apiKey: groqKey,
      model: GROQ_MODEL,
    });
  }

  // 3. OpenRouter (fallback — 4 trios of free models)
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (openrouterKey) {
    providers.push({
      name: "OpenRouter",
      url: OPENROUTER_CHAT_URL,
      apiKey: openrouterKey,
      model: OPENROUTER_MODEL,
      fallbackModels: OPENROUTER_FALLBACK_MODELS,
      extraHeaders: {
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
    });
  }

  return providers;
}

// ─── OpenRouter trio routes (for the fallback phase) ──────────────────────

type FreeRoute = { model: string; models: readonly string[] };

const OR_ROUTES: FreeRoute[] = [
  { model: OPENROUTER_MODEL, models: OPENROUTER_FALLBACK_MODELS },
  { model: OPENROUTER_RETRY_MODEL, models: OPENROUTER_RETRY_FALLBACKS },
  { model: OPENROUTER_RETRY2_MODEL, models: OPENROUTER_RETRY2_FALLBACKS },
  { model: OPENROUTER_RETRY3_MODEL, models: OPENROUTER_RETRY3_FALLBACKS },
];

// ─── Shared helpers ────────────────────────────────────────────────────────

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, BACKOFF_MAX_MS);
  }
  const date = new Date(header);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return delta > 0 ? Math.min(delta, BACKOFF_MAX_MS) : null;
  }
  return null;
}

function backoffDelay(round: number, retryAfterMs: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  const base = BACKOFF_BASE_MS * (1 << round);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(base + jitter, BACKOFF_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_MESSAGE =
  "The free model pool is busy right now. Wait a moment and try again; a retry usually gets through.";

// ─── Single-provider request ──────────────────────────────────────────────

async function requestProvider(
  provider: Provider,
  messages: ModelMessage[],
): Promise<{ status: number; text: string; retryAfterMs: number | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${provider.apiKey}`,
    "Content-Type": "application/json",
    ...provider.extraHeaders,
  };

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: 0.2,
    max_tokens: 700,
  };
  // OpenRouter supports a "models" array for in-call fallback.
  if (provider.fallbackModels) {
    body.models = provider.fallbackModels;
  }

  let response: Response;
  try {
    response = await fetch(provider.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) return { status: 408, text: "", retryAfterMs: null };
    throw error;
  }

  const raw = await response.text();
  if (!response.ok) {
    console.error(`${provider.name} chat failed`, response.status, provider.model, raw.slice(0, 500));
    return { status: response.status, text: "", retryAfterMs: parseRetryAfter(response) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new LLMError(502, `${provider.name} returned an unreadable response.`);
  }

  const text = answerFromPayload(payload);
  if (text) return { status: response.status, text, retryAfterMs: null };

  const recovered = answerFromReasoning(payload);
  if (recovered) return { status: response.status, text: recovered, retryAfterMs: null };

  console.warn(`${provider.name} (${provider.model}) returned no usable answer text.`);
  return { status: response.status, text: "", retryAfterMs: null };
}

// ─── OpenRouter multi-trio fallback ────────────────────────────────────────

async function requestOpenRouterTrio(
  key: string,
  messages: ModelMessage[],
  route: FreeRoute,
): Promise<{ status: number; text: string; retryAfterMs: number | null }> {
  const ids = [route.model, ...route.models];
  assertFreeChatModels(ids);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
      body: JSON.stringify({
        model: route.model,
        models: route.models,
        messages,
        temperature: 0.2,
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) return { status: 408, text: "", retryAfterMs: null };
    throw error;
  }

  const raw = await response.text();
  if (!response.ok) {
    console.error("OpenRouter trio failed", response.status, route.model, raw.slice(0, 500));
    return { status: response.status, text: "", retryAfterMs: parseRetryAfter(response) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new LLMError(502, "OpenRouter returned an unreadable response.");
  }

  const text = answerFromPayload(payload);
  if (text) return { status: response.status, text, retryAfterMs: null };

  const recovered = answerFromReasoning(payload);
  if (recovered) return { status: response.status, text: recovered, retryAfterMs: null };

  console.warn(`OpenRouter route ${route.model} returned no usable answer text.`);
  return { status: response.status, text: "", retryAfterMs: null };
}

async function openRouterFallback(
  key: string,
  messages: ModelMessage[],
): Promise<string | null> {
  const maxRounds = OR_ROUTES.length;
  let lastStatus = 0;
  let sawEmptyText = false;

  for (let round = 0; round < maxRounds; round++) {
    const route = OR_ROUTES[round];
    const result = await requestOpenRouterTrio(key, messages, route);

    if (result.text) return result.text;

    lastStatus = result.status;
    const emptyText = result.status === 200;
    if (emptyText) sawEmptyText = true;

    if (!isRetryable(result.status)) break;

    if (round < maxRounds - 1) {
      if (emptyText) continue;
      const delay = backoffDelay(round, result.retryAfterMs);
      await sleep(delay);
    }
  }

  if (sawEmptyText && lastStatus === 200) {
    console.warn("OpenRouter fallback: all trios returned empty text.");
  }
  return null;
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Try providers in cascade order. Each provider gets one attempt (no retry
 * within a provider — the cascade itself is the retry strategy). OpenRouter
 * gets its full 4-trio rotation as the final fallback.
 */
export async function completeChat(messages: ModelMessage[]): Promise<string> {
  const configError = llmConfigError();
  if (configError) throw new LLMError(503, configError);

  const providers = availableProviders();
  if (providers.length === 0) {
    throw new LLMError(503, "No LLM API key is configured.");
  }

  let lastError = "";

  for (const provider of providers) {
    // OpenRouter is handled by the multi-trio fallback path.
    if (provider.name === "OpenRouter") {
      const orKey = provider.apiKey;
      const result = await openRouterFallback(orKey, messages);
      if (result) return result;
      lastError = RATE_LIMIT_MESSAGE;
      continue;
    }

    // Mistral / Groq: single attempt each.
    const result = await requestProvider(provider, messages);
    if (result.text) return result.text;

    if (!isRetryable(result.status)) {
      // Fatal error for this provider — log and try the next one.
      console.warn(`${provider.name} fatal error (${result.status}), trying next provider…`);
      lastError = `${provider.name} returned an error (${result.status}).`;
      continue;
    }

    // Rate-limited or timed out — try the next provider without waiting.
    // The cascade itself provides enough delay between attempts.
    console.warn(`${provider.name} rate-limited (${result.status}), trying next provider…`);
    lastError = RATE_LIMIT_MESSAGE;
  }

  // All providers exhausted.
  throw new LLMError(502, lastError || RATE_LIMIT_MESSAGE);
}
