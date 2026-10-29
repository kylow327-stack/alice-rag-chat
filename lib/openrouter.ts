import {
  OPENROUTER_CHAT_URL,
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MODEL,
  OPENROUTER_REFERER,
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

async function requestRoute(
  key: string,
  messages: ModelMessage[],
  route: FreeRoute,
): Promise<{ status: number; text: string }> {
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
    if (isTimeout(error)) return { status: 408, text: "" };
    throw error;
  }

  const raw = await response.text();
  if (!response.ok) {
    console.error("OpenRouter chat failed", response.status, route.model, raw.slice(0, 500));
    return { status: response.status, text: "" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new OpenRouterError(502, "OpenRouter returned an unreadable response.");
  }
  return { status: response.status, text: answerFromPayload(payload) };
}

export async function completeChat(messages: ModelMessage[]): Promise<string> {
  const configError = openRouterConfigError();
  if (configError) throw new OpenRouterError(503, configError);

  assertFreeChatModels([PRIMARY_ROUTE.model, ...PRIMARY_ROUTE.models]);
  assertFreeChatModels([RETRY_ROUTE.model, ...RETRY_ROUTE.models]);

  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const first = await requestRoute(key, messages, PRIMARY_ROUTE);
  if (first.text) return first.text;
  const retryable = first.status === 429 || first.status === 408 || first.status < 400;
  if (!retryable) throw providerError(first.status, PRIMARY_ROUTE.model);

  const second = await requestRoute(key, messages, RETRY_ROUTE);
  if (second.text) return second.text;
  if (second.status === 429 || second.status === 408 || second.status < 400) {
    throw new OpenRouterError(502, RATE_LIMIT_MESSAGE);
  }
  throw providerError(second.status, RETRY_ROUTE.model);
}
