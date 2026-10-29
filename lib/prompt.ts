import { chapterLabel } from "./retrieve";
import type { ChatMessage, Hit, ModelMessage } from "./types";

export const REFUSAL =
  "I do not find that in Alice's Adventures in Wonderland. This demo only answers from the book, and it will not guess.";

const SYSTEM = `You answer questions about Alice's Adventures in Wonderland by Lewis Carroll. Use only the passages in the final user message. Do not use anything else: not other books, not film or stage adaptations, and not general knowledge.

If the passages contain the answer, write one to three short paragraphs of plain prose. You may quote a few words and you may name the chapter. Do not use markdown, passage numbers, or chunk ids.

If the passages do not contain the answer, or you are not sure, reply with exactly NOT_IN_BOOK and no other text.`;

export function formatPassages(hits: Hit[]): string {
  return hits
    .map((hit, index) => {
      return `Passage ${index + 1}. ${chapterLabel(hit)} (${hit.chunk.id})\n${hit.chunk.text}`;
    })
    .join("\n\n");
}

export function retrievalQuery(messages: ChatMessage[]): string {
  const users = messages.filter((message) => message.role === "user");
  const latest = users.at(-1)?.content ?? "";
  const previous = users.at(-2)?.content;
  const words = latest.trim().split(/\s+/).filter(Boolean);
  if (previous && words.length > 0 && words.length < 12) {
    return `${previous}\n${latest}`;
  }
  return latest;
}

export function groundedMessages(messages: ChatMessage[], hits: Hit[]): ModelMessage[] {
  const latest = messages.at(-1);
  const question = latest?.role === "user" ? latest.content : "";
  const grounded = `Passages from the book:\n\n${formatPassages(hits)}\n\nQuestion: ${question}`;
  const prior = messages.slice(0, -1);
  return [{ role: "system", content: SYSTEM }, ...prior, { role: "user", content: grounded }];
}

export function isModelRefusal(text: string): boolean {
  const normalized = text.trim().replace(/^["']+|["']+$/g, "").trim();
  return /^NOT_IN_BOOK\b[.!]?$/i.test(normalized);
}

export function plainAnswer(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\*\*/g, "")
    .trim();
}
