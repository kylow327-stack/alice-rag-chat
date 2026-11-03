import { completeChat, LLMError, llmConfigError } from "@/lib/llm";
import {
  groundedMessages,
  isModelRefusal,
  plainAnswer,
  REFUSAL,
  retrievalQuery,
} from "@/lib/prompt";
import { assess, toCitation } from "@/lib/retrieve";
import type { ChatMessage, ChatSuccess, Hit } from "@/lib/types";

export const maxDuration = 180;

// ─── In-memory response cache ───────────────────────────────────────────────
// Identical questions within the TTL window return the cached answer instead
// of hitting OpenRouter again. This reduces rate-limit pressure from repeat
// questions without persisting anything to disk.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX = 64; // max entries — LRU-ish (oldest evicted on size overflow)

type CacheEntry = {
  answer: ChatSuccess;
  expiresAt: number;
};

const responseCache = new Map<string, CacheEntry>();

function cacheKey(messages: ChatMessage[]): string {
  // Only key on the actual message content — role + content of each turn.
  return messages.map((m) => `${m.role}:${m.content}`).join("|");
}

function cacheGet(key: string): ChatSuccess | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  // Move to end (most-recently-used) for simple LRU.
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.answer;
}

function cacheSet(key: string, answer: ChatSuccess): void {
  if (responseCache.size >= CACHE_MAX) {
    // Evict oldest entry (first in insertion order).
    const oldest = responseCache.keys().next();
    if (!oldest.done) responseCache.delete(oldest.value);
  }
  responseCache.set(key, {
    answer,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}
// ─── End cache ──────────────────────────────────────────────────────────────

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

// Maximum messages the server will process. Excess turns are truncated
// from the front (oldest dropped) so the latest question is always included.
const MAX_MESSAGES = 8;

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== "object" || !("messages" in body)) return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const parsed: ChatMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") return null;
    const role = (message as { role?: unknown }).role;
    const content = (message as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) return null;
    parsed.push({ role, content: trimmed });
  }
  // Keep only the last MAX_MESSAGES turns. This lets long conversations
  // continue working without a 400 error.
  const trimmed = parsed.slice(-MAX_MESSAGES);
  if (trimmed.at(-1)?.role !== "user") return null;
  return trimmed;
}

export async function POST(request: Request) {
  const configError = llmConfigError();
  if (configError) {
    return json({ error: configError, code: "missing_api_key" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body.", code: "bad_request" }, 400);
  }

  const messages = parseMessages(body);
  if (!messages) {
    return json(
      {
        error:
          "Send at least one message. The last one must be a user question under 2000 characters.",
        code: "bad_request",
      },
      400,
    );
  }

  // Check cache before running retrieval or calling the model.
  const key = cacheKey(messages);
  const cached = cacheGet(key);
  if (cached) {
    return json(cached, 200);
  }

  const assessment = assess(retrievalQuery(messages));
  if (assessment.refused) {
    const refused: ChatSuccess = { answer: REFUSAL, refused: true, citations: [] };
    // Refusals are cheap to compute — cache them too so repeat off-book
    // questions don't even hit the retrieval step.
    cacheSet(key, refused);
    return json(refused, 200);
  }

  try {
    const completion = await answerFromPassages(messages, assessment.hits);
    // Cache successful completions (including model refusals) to avoid
    // re-calling OpenRouter for the same question within the TTL window.
    cacheSet(key, completion);
    return json(completion, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The model provider returned an error.";
    const status = error instanceof LLMError ? error.status : 502;
    return json({ error: message, code: "provider_error" }, status);
  }
}

async function answerFromPassages(messages: ChatMessage[], hits: Hit[]): Promise<ChatSuccess> {
  const text = plainAnswer(await completeChat(groundedMessages(messages, hits)));
  if (isModelRefusal(text)) {
    return { answer: REFUSAL, refused: true, citations: [] };
  }
  return {
    answer: text,
    refused: false,
    citations: hits.map(toCitation),
  };
}
