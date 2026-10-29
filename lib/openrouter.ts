import {
  OPENROUTER_CHAT_URL,
  OPENROUTER_MODEL,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
} from "./constants";
import type { ModelMessage } from "./types";

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

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

export async function completeChat(messages: ModelMessage[]): Promise<string> {
  const configError = openRouterConfigError();
  if (configError) throw new OpenRouterError(503, configError);

  if (!OPENROUTER_MODEL.endsWith(":free")) {
    throw new OpenRouterError(500, "Refusing to call an OpenRouter model that is not on the free tier.");
  }

  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
      "X-Title": OPENROUTER_TITLE,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    console.error("OpenRouter chat failed", response.status, raw.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new OpenRouterError(
        502,
        "OpenRouter rejected the key. Check OPENROUTER_API_KEY.",
      );
    }
    if (response.status === 404) {
      throw new OpenRouterError(
        502,
        `OpenRouter does not serve ${OPENROUTER_MODEL} anymore. Pick another model id that ends in :free.`,
      );
    }
    if (response.status === 429) {
      throw new OpenRouterError(502, "OpenRouter rate-limited this demo. Try again shortly.");
    }
    throw new OpenRouterError(502, "OpenRouter returned an error. Try again shortly.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new OpenRouterError(502, "OpenRouter returned an unreadable response.");
  }

  const choice = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
    ?.message?.content;
  const text = messageText(choice);
  if (!text) {
    throw new OpenRouterError(502, "OpenRouter returned an empty answer.");
  }
  return text;
}
