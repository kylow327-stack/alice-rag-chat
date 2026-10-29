/**
 * Some free OpenRouter routes put a chain-of-thought in `message.content`
 * (for example a "Here's a thinking process:" preamble) even when a separate
 * `reasoning` field also exists. The chat UI should show only the final reply.
 */

const THINKING_HEAD =
  /here(?:'|’)s a thinking process|\bthinking process\b|\banalyze user input\b|^\s*(?:thinking|reasoning)\s*:/i;

const FINAL_MARKER =
  /(?:^|\n)\s*(?:here(?:'|’)s the (?:final )?answer|final answer|the answer)\s*:\s*/i;

const SCRATCH_LINE =
  /^(?:here(?:'|’)s a thinking process\b|\bthinking process\b|\banalyze user input\b|\d+[\.\)]\s+(?:analyze|check|identify|consider|review|examine|determine|look|find|read|note)\b|(?:analyze|check|identify|consider|review|examine|determine)\b)/i;

export function looksLikeChainOfThought(text: string): boolean {
  return THINKING_HEAD.test(text.slice(0, 700));
}

function isScratchLine(line: string): boolean {
  return SCRATCH_LINE.test(line.trim());
}

/** Keep a normal reply. If the text is scratchwork plus a closing answer, keep the closing answer. */
export function extractFinalAnswer(raw: string): string {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/\*\*/g, "")
    .trim();
  if (!text) return "";
  if (!looksLikeChainOfThought(text)) return text;

  const markers = [...text.matchAll(new RegExp(FINAL_MARKER.source, "gi"))];
  const marked = markers.at(-1);
  if (marked) {
    const tail = text.slice(marked.index + marked[0].length).trim();
    if (tail && !looksLikeChainOfThought(tail)) return tail;
  }

  const lines = text.split("\n");
  let sawScratch = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    if (isScratchLine(line)) {
      sawScratch = true;
      continue;
    }
    if (!sawScratch) continue;
    const rest = lines.slice(index).join("\n").trim();
    if (rest && !looksLikeChainOfThought(rest)) return rest;
  }

  const sentinel = text.match(/(?:^|\n)\s*(NOT_IN_BOOK)\b[.!]?\s*$/i);
  if (sentinel?.[1]) return "NOT_IN_BOOK";
  return "";
}

type MessagePart = { type?: unknown; text?: unknown };

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const typed = part as MessagePart;
      if (typed.type === "reasoning") return "";
      return typeof typed.text === "string" ? typed.text : "";
    })
    .join("")
    .trim();
}

/**
 * Prefer `message.content`. Never surface `reasoning` or `reasoning_details`.
 * Returns "" when the only text is scratchwork with no final reply.
 */
export function answerFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choice = (
    payload as {
      choices?: { text?: unknown; message?: { content?: unknown } }[];
    }
  ).choices?.[0];
  const content = contentText(choice?.message?.content);
  if (content) return extractFinalAnswer(content);
  if (typeof choice?.text === "string" && choice.text.trim()) {
    return extractFinalAnswer(choice.text);
  }
  return "";
}
