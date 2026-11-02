import {
  OPENROUTER_BACKOFF_BASE_MS,
  OPENROUTER_BACKOFF_MAX_MS,
  OPENROUTER_CHAT_URL,
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MAX_ROUNDS,
  OPENROUTER_MODEL,
  OPENROUTER_REFERER,
  OPENROUTER_RETRY2_FALLBACKS,
  OPENROUTER_RETRY2_MODEL,
  OPENROUTER_RETRY_FALLBACKS,
  OPENROUTER_RETRY_MODEL,
  OPENROUTER_TITLE,
} from "./constants";
import { answerFromPayload } from "./extract-answer";
import type { ModelMessage } from "./types";

const OPENROUTER_TIMEOUT_MS = 90_000;

const RATE_LIMIT_MESSAGE =
  "The free shared model pool is busy right now. Wait a moment and try again; a retry usually gets through.";

export class OpenRouterError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export function openRouterConfigError(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!key) return "OPENROUTER_API_KEY is not configured.";
  return null;
}

/** Refuse any chat id that is not an OpenRouter free route. At most three ids per call. */
export function assertFreeChatModels(ids: readonly string[]): void {
  if (ids.length === 0 || ids.length > 3) {
    throw new OpenRouterError(500, "Refusing to call an OpenRouter model that is not on the free tier.");
  }
  for (const id of ids) {
    if (!id.endsWith(":free")) {
      throw new OpenRouterError(500, "Refusing to call an OpenRouter model that is not on the free tier.");
    }
  }
}

type FreeRoute = {
  model: string;
  models: readonly string[];
};

const PRIMARY_ROUTE: FreeRoute = {
  model: OPENROUTER_MODEL,
  models: OPENROUTER_FALLBACK_MODELS,
};

const RETRY_ROUTE: FreeRoute = {
  model: OPENROUTER_RETRY_MODEL,
  models: OPENROUTER_RETRY_FALLBACKS,
};

const RETRY2_ROUTE: FreeRoute = {
  model: OPENROUTER_RETRY2_MODEL,
  models: OPENROUTER_RETRY2_FALLBACKS,
};

/** All trios, tried in order. */
const ALL_ROUTES: FreeRoute[] = [PRIMARY_ROUTE, RETRY_ROUTE, RETRY2_ROUTE];

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function providerError(status: number, model: string): OpenRouterError {
  if (status === 401 || status === 403) {
    return new OpenRouterError(502, "OpenRouter rejected the key. Check OPENROUTER_API_KEY.");
  }
  if (status === 404) {
    return new OpenRouterError(
      502,
      `OpenRouter does not serve ${model} anymore. Pick another model id that ends in :free.`,
    );
  }
  if (status === 429) {
    return new OpenRouterError(502, RATE_LIMIT_MESSAGE);
  }
  if (status === 408) {
    return new OpenRouterError(502, "The free model took too long to answer. Try again in a moment.");
  }
  return new OpenRouterError(502, "OpenRouter returned an error. Try again shortly.");
}

/** True if the HTTP status is worth retrying with a different trio. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status === 503 || status < 400;
}

/** Parse Retry-After header (seconds or HTTP-date). Returns ms, or null. */
function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, OPENROUTER_BACKOFF_MAX_MS);
  }
  const date = new Date(header);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return delta > 0 ? Math.min(delta, OPENROUTER_BACKOFF_MAX_MS) : null;
  }
  return null;
}

/** Exponential backoff delay for a given round (0-indexed). */
function backoffDelay(round: number, retryAfterMs: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  const base = OPENROUTER_BACKOFF_BASE_MS * (1 << round); // 2s, 4s, 8s, 16s...
  const jitter = Math.floor(Math.random() * 500); // 0–499ms jitter to avoid thundering herd
  return Math.min(base + jitter, OPENROUTER_BACKOFF_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestRoute(
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
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) return { status: 408, text: "", retryAfterMs: null };
    throw error;
  }

  const raw = await response.text();
  if (!response.ok) {
    console.error("OpenRouter chat failed", response.status, route.model, raw.slice(0, 500));
    return { status: response.status, text: "", retryAfterMs: parseRetryAfter(response) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new OpenRouterError(502, "OpenRouter returned an unreadable response.");
  }
  return { status: response.status, text: answerFromPayload(payload), retryAfterMs: null };
}

/**
 * Try each free model trio in sequence. Between rate-limited trios, wait
 * with exponential backoff (or the Retry-After header value if the server
 * provides one) before trying the next trio.
 */
export async function completeChat(messages: ModelMessage[]): Promise<string> {
  const configError = openRouterConfigError();
  if (configError) throw new OpenRouterError(503, configError);

  // Validate all routes upfront so a bad config fails fast.
  for (const route of ALL_ROUTES) {
    assertFreeChatModels([route.model, ...route.models]);
  }

  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const maxRounds = Math.min(OPENROUTER_MAX_ROUNDS, ALL_ROUTES.length);
  let lastStatus = 0;
  let lastModel = "";

  for (let round = 0; round < maxRounds; round++) {
    const route = ALL_ROUTES[round];
    const result = await requestRoute(key, messages, route);

    if (result.text) return result.text;

    lastStatus = result.status;
    lastModel = route.model;

    // Non-retryable error — stop immediately.
    if (!isRetryable(result.status)) {
      throw providerError(result.status, route.model);
    }

    // If this isn't the last round, wait before trying the next trio.
    if (round < maxRounds - 1) {
      const delay = backoffDelay(round, result.retryAfterMs);
      console.warn(
        `OpenRouter round ${round + 1} failed (${result.status}), ` +
          `waiting ${Math.round(delay / 1000)}s before next trio…`,
      );
      await sleep(delay);
    }
  }

  // All rounds exhausted.
  if (lastStatus === 429 || lastStatus === 408 || lastStatus === 503) {
    throw new OpenRouterError(502, RATE_LIMIT_MESSAGE);
  }
  throw providerError(lastStatus, lastModel);
}
