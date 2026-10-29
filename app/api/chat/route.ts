import { completeChat, OpenRouterError, openRouterConfigError } from "@/lib/openrouter";
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

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== "object" || !("messages" in body)) return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 8) {
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
  if (parsed.at(-1)?.role !== "user") return null;
  return parsed;
}

export async function POST(request: Request) {
  const configError = openRouterConfigError();
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
        error: "Send 1–8 messages. The last one must be a user question under 2000 characters.",
        code: "bad_request",
      },
      400,
    );
  }

  const assessment = assess(retrievalQuery(messages));
  if (assessment.refused) {
    const refused: ChatSuccess = { answer: REFUSAL, refused: true, citations: [] };
    return json(refused, 200);
  }

  try {
    const completion = await answerFromPassages(messages, assessment.hits);
    return json(completion, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The model provider returned an error.";
    const status = error instanceof OpenRouterError ? error.status : 502;
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
