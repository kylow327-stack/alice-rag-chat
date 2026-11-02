"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Citation } from "@/lib/types";

type Turn = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  refused?: boolean;
};

const EXAMPLES = [
  "Why does Alice follow the White Rabbit?",
  "What happens at the Mad Tea-Party?",
  "Who painted the white roses red?",
  "What is the capital of France?",
];

// ─── Client-side retry config ───────────────────────────────────────────────
// When the server returns 502 (provider_error / rate-limited), the client
// automatically retries up to MAX_RETRIES times with exponential backoff.
// This gives the server-side backoff + model rotation time to land on a
// free model that isn't rate-limited.
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2_000; // 2s, 4s, 8s
const RETRY_MAX_DELAY_MS = 10_000;

function retryDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * (1 << attempt); // 2s, 4s, 8s
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(base + jitter, RETRY_MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChatResponse = {
  answer?: string;
  refused?: boolean;
  citations?: Citation[];
  error?: string;
  code?: string;
};

export function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns, pending, retrying, error]);

  async function chatFetch(
    messages: { role: string; content: string }[],
    signal: AbortSignal,
  ): Promise<{ ok: boolean; data: ChatResponse; status: number }> {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
    const data = (await response.json()) as ChatResponse;
    return { ok: response.ok, data, status: response.status };
  }

  async function ask(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    setError(null);
    setRetrying(false);
    setRetryCount(0);

    const nextTurns: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(nextTurns);
    setDraft("");
    setPending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const payload = nextTurns.map((turn) => ({ role: turn.role, content: turn.content }));

    try {
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          setRetrying(true);
          setRetryCount(attempt);
          await sleep(retryDelay(attempt - 1));
        }

        const result = await chatFetch(payload, controller.signal);

        if (controller.signal.aborted) return;

        if (result.ok && typeof result.data.answer === "string") {
          setTurns([
            ...nextTurns,
            {
              role: "assistant",
              content: result.data.answer,
              citations: result.data.citations ?? [],
              refused: result.data.refused === true,
            },
          ]);
          return;
        }

        // Non-retryable errors — show immediately, no retry.
        if (result.data.code === "missing_api_key" || result.data.code === "bad_request") {
          setError(
            result.data.code === "missing_api_key"
              ? "This server has no OpenRouter key, so chat returns 503. Set OPENROUTER_API_KEY (a free key from openrouter.ai/keys) and reload."
              : (result.data.error ?? "The request failed."),
          );
          return;
        }

        // Retryable error (provider_error / rate-limited / 502)
        lastError = result.data.error ?? "The model provider returned an error.";

        if (attempt < MAX_RETRIES) {
          // Keep looping — the retry state is already set.
          continue;
        }
      }

      // All retries exhausted.
      if (!controller.signal.aborted) {
        setError(
          lastError ??
            "The free model pool is busy after several retries. Please try again in a moment.",
        );
      }
    } catch {
      if (!controller.signal.aborted) {
        setError("The network request failed.");
      }
    } finally {
      setPending(false);
      setRetrying(false);
      setRetryCount(0);
      abortRef.current = null;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(draft);
    }
  }

  const pendingLabel = retrying
    ? `Retrying… (attempt ${retryCount} of ${MAX_RETRIES})`
    : "Reading the passage…";

  return (
    <section className="mt-8 flex flex-1 flex-col border border-line bg-paper-raised">
      <div ref={logRef} className="flex flex-col gap-5 px-4 py-5 sm:px-6" aria-live="polite">
        {turns.length === 0 ? (
          <div>
            <p className="text-ink-soft">
              Try a question about the book. The last example is not in the story, and the demo should say so.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    className="w-full border border-line px-3 py-2 text-left text-navy hover:border-navy disabled:opacity-50"
                    onClick={() => void ask(example)}
                    disabled={pending}
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {turns.map((turn, index) =>
          turn.role === "user" ? (
            <p key={`${turn.role}-${index}`} className="ml-8 bg-navy px-3 py-2 text-paper">
              {turn.content}
            </p>
          ) : (
            <article key={`${turn.role}-${index}`} className="mr-8">
              {turn.refused ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-signal">
                  Not in the book
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-ink">{turn.content}</p>
              {turn.citations && turn.citations.length > 0 ? (
                <ul aria-label="Citations" className="mt-3 flex flex-col gap-2">
                  {turn.citations.map((citation) => (
                    <li key={citation.id} className="border-l-4 border-signal bg-signal-soft px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-signal">
                        {citation.chapter}
                      </p>
                      <p className="text-xs text-navy">{citation.id}</p>
                      <blockquote className="mt-1 text-sm text-ink">“{citation.quote}”</blockquote>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ),
        )}
        {pending ? <p className="text-ink-soft">{pendingLabel}</p> : null}
        {error ? (
          <p role="alert" className="border border-signal bg-signal-soft px-3 py-2 text-ink">
            {error}
          </p>
        ) : null}
      </div>
      <form onSubmit={onSubmit} className="border-t border-line p-4 sm:p-5">
        <label htmlFor="question" className="text-sm font-semibold text-navy">
          Ask about the book
        </label>
        <textarea
          id="question"
          name="question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={2000}
          placeholder="Why does Alice follow the White Rabbit?"
          className="mt-2 w-full resize-y border border-line bg-paper px-3 py-2 text-ink placeholder:text-ink-soft"
          disabled={pending}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-soft">Enter to send. Shift+Enter for a new line.</p>
          <button
            type="submit"
            className="bg-navy px-4 py-2 font-semibold text-paper hover:bg-navy-deep disabled:opacity-50"
            disabled={pending || draft.trim().length === 0}
          >
            Ask
          </button>
        </div>
      </form>
    </section>
  );
}
