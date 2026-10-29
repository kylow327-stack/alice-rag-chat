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

export function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns, pending, error]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setError(null);
    const nextTurns: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(nextTurns);
    setDraft("");
    setPending(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextTurns.map((turn) => ({ role: turn.role, content: turn.content })),
        }),
      });
      const data = (await response.json()) as {
        answer?: string;
        refused?: boolean;
        citations?: Citation[];
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setError(
          data.code === "missing_api_key"
            ? "This server has no OpenRouter key, so chat returns 503. Set OPENROUTER_API_KEY (a free key from openrouter.ai/keys) and reload."
            : (data.error ?? "The request failed."),
        );
        return;
      }
      if (typeof data.answer !== "string") {
        setError("The server returned an unexpected response.");
        return;
      }
      setTurns([
        ...nextTurns,
        {
          role: "assistant",
          content: data.answer,
          citations: data.citations ?? [],
          refused: data.refused === true,
        },
      ]);
    } catch {
      setError("The network request failed.");
    } finally {
      setPending(false);
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
        {pending ? <p className="text-ink-soft">Reading the passage…</p> : null}
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
