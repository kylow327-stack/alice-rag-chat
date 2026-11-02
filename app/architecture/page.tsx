import type { Metadata } from "next";
import {
  COSINE_WITHOUT_OVERLAP,
  DEEPSEEK_CHAT_URL,
  DEEPSEEK_MODEL,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  GROQ_CHAT_URL,
  GROQ_MODEL,
  GUTENBERG_ID,
  LEXICAL_WEIGHT,
  BACKOFF_BASE_MS,
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
  SCORE_FLOOR,
  SOURCE_URL,
  TOKENIZER,
  TOP_K,
} from "@/lib/constants";

export const metadata: Metadata = {
  title: "Architecture",
  description:
    "How this demo retrieves passages from Alice in Wonderland and answers with OpenRouter.",
};

const STEPS = [
  {
    title: "Corpus",
    body: `The ingest script downloads Project Gutenberg eBook #${GUTENBERG_ID} and keeps the twelve chapters. The Gutenberg header, footer, and license are not stored.`,
  },
  {
    title: "Chunks",
    body: "Paragraphs are unwrapped and packed to about 1,400 characters, still inside a chapter. Each chunk has an id such as ch07-p06.",
  },
  {
    title: "Local embeddings",
    body: `Token vectors come from ${EMBEDDING_MODEL}, mean-pooled with the ${TOKENIZER} WordPiece tokenizer, then cut to the first ${EMBEDDING_DIM} Matryoshka dimensions and L2-normalized. Ingest writes them once. The server does not call an embedding API and does not load a transformer.`,
  },
  {
    title: "Retrieve",
    body: `A question is embedded the same way. Chunks are ranked by cosine plus ${LEXICAL_WEIGHT} times the share of the question’s content words found in the chunk, including its chapter title. The lexical term keeps names like “Tea-Party” from being outranked by a vague semantic neighbor. The top ${TOP_K} chunks are the context.`,
  },
  {
    title: "Refuse",
    body: `If the best hybrid score is below ${SCORE_FLOOR}, or the passages share no content words with the question and the cosine is below ${COSINE_WITHOUT_OVERLAP}, the route does not call the model. It returns a plain refusal. If the model itself answers NOT_IN_BOOK, the same refusal is shown and the citations are dropped.`,
  },
  {
    title: "Generate",
    body: `Otherwise the passages and the question go to a multi-provider LLM cascade. DeepSeek is tried first (${DEEPSEEK_MODEL} via ${DEEPSEEK_CHAT_URL}); if it is unavailable, Groq is tried next (${GROQ_MODEL} via ${GROQ_CHAT_URL}); if both are busy, OpenRouter's free-tier rotation kicks in as the last resort. All three are OpenAI-compatible. The reply is prose. Citations are the retrieved chunks — id, chapter, and a short quote — not spans invented by the model.`,
  },
];

export default function ArchitecturePage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-navy">How it works</p>
      <h1 className="mt-2 font-serif text-4xl text-navy sm:text-5xl">Architecture</h1>
      <p className="mt-4 text-lg text-ink-soft">
        A small retrieval-augmented chat over one public-domain book. There is no
        account, no file upload, and no hosted embedding API. Generation uses a
        multi-provider cascade: DeepSeek (primary) → Groq (secondary) → OpenRouter free tier (fallback).
      </p>

      <ol className="mt-8 flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="border border-line bg-paper-raised px-4 py-3">
            <h2 className="font-serif text-xl text-navy">
              {index + 1}. {step.title}
            </h2>
            <p className="mt-1 text-ink">{step.body}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 font-serif text-2xl text-navy">Models</h2>
      <dl className="mt-4 flex flex-col gap-4">
        <div className="border-l-4 border-navy pl-3">
          <dt className="text-sm font-semibold text-navy">Chat — Provider Cascade</dt>
          <dd className="mt-1 text-ink">
            <span className="block">
              The app tries three OpenAI-compatible providers in order:
            </span>
            <ol className="mt-2 list-decimal pl-5">
              <li>
                <strong>DeepSeek</strong> —{" "}
                <code className="bg-paper px-1.5 py-0.5 text-navy">{DEEPSEEK_MODEL}</code> via{" "}
                <code className="text-navy">{DEEPSEEK_CHAT_URL}</code>. Paid API but extremely
                cheap ($0.14/M input, $0.28/M output — ~$0.0002 per answer). No rate-limit
                pressure; the primary provider.
              </li>
              <li>
                <strong>Groq</strong> —{" "}
                <code className="bg-paper px-1.5 py-0.5 text-navy">{GROQ_MODEL}</code> via{" "}
                <code className="text-navy">{GROQ_CHAT_URL}</code>. Free tier: 30 RPM / 1,000 RPD.
                Ultra-fast LPU inference; the secondary fallback.
              </li>
              <li>
                <strong>OpenRouter</strong> — 4 trios of free models via{" "}
                <code className="text-navy">{OPENROUTER_CHAT_URL}</code>. The last resort.
                One request tries <code className="text-navy">{OPENROUTER_MODEL}</code>, then{" "}
                {OPENROUTER_FALLBACK_MODELS.join(" and ")}. If that free trio is
                rate-limited or returns nothing, the server waits{" "}
                {BACKOFF_BASE_MS / 1000}s and tries a second free-only trio
                ({OPENROUTER_RETRY_MODEL} + {OPENROUTER_RETRY_FALLBACKS.join(", ")}),
                then a third ({OPENROUTER_RETRY2_MODEL} +{" "}
                {OPENROUTER_RETRY2_FALLBACKS.join(", ")}), then a fourth
                ({OPENROUTER_RETRY3_MODEL} + {OPENROUTER_RETRY3_FALLBACKS.join(", ")}),
                with the backoff doubling each round. The server also respects the{" "}
                <code className="text-navy">Retry-After</code> header. The client refuses any
                OpenRouter model id that does not end in <code className="text-navy">:free</code>.
              </li>
            </ol>
            <span className="mt-3 block">
              Temperature is 0.2 across all providers. The reply is the OpenAI-style{" "}
              <code className="text-navy">choices[0].message.content</code>. A separate reasoning
              trace is ignored unless content is empty, in which case the server looks for a
              final-answer marker inside the reasoning field. If the text itself opens with a
              thinking-process preamble, only the final answer is shown.
            </span>
            <span className="mt-2 block">
              The OpenRouter free tier retires models regularly, so a retired id returns 404.
              That is treated as a model-level failure and the request falls through to the next
              trio instead of failing outright. The{" "}
              <code className="text-navy">npm run check:models</code> script compares every
              configured OpenRouter id against the live catalog and fails when one has been retired.
            </span>
            <span className="mt-2 block">
              The client also retries automatically: on a 502{" "}
              <code className="text-navy">provider_error</code>, it waits and sends the request
              again (up to 3 retries with 2s/4s/8s backoff), showing a &ldquo;Retrying…&rdquo;
              indicator instead of an error.
            </span>
            <span className="mt-2 block">
              Identical questions within a 5-minute window are served from an in-memory cache,
              so repeat questions do not hit any provider at all.
            </span>
          </dd>
        </div>
        <div className="border-l-4 border-signal pl-3">
          <dt className="text-sm font-semibold text-signal">Embeddings</dt>
          <dd className="mt-1 text-ink">
            <code className="bg-paper px-1.5 py-0.5 text-navy">{EMBEDDING_MODEL}</code>
            <span className="mt-2 block">
              Static retrieval model: a table lookup and a mean pool, about as
              accurate as a small transformer encoder and cheap enough to run inside
              a serverless function. The full 1,024-dimensional matrix is downloaded
              only by <code className="text-navy">npm run ingest</code>. The repo
              ships the first {EMBEDDING_DIM} dimensions as float16, plus{" "}
              <code className="text-navy">data/vocab.txt</code> and the chunk index.
              Query embedding is that same table, so a cold start does not download
              or initialize ONNX. Retrieval does not call OpenRouter.
            </span>
          </dd>
        </div>
      </dl>

      <h2 className="mt-10 font-serif text-2xl text-navy">What the server stores</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-ink">
        <li>
          <code className="text-navy">data/alice-index.json</code> — chunk id, chapter, title, text
        </li>
        <li>
          <code className="text-navy">data/chunk-embeddings.f16</code> — one normalized vector per chunk
        </li>
        <li>
          <code className="text-navy">data/token-embeddings.f16</code> — the truncated token table
        </li>
        <li>
          <code className="text-navy">data/vocab.txt</code> — bert-base-uncased vocabulary
        </li>
      </ul>
      <p className="mt-3 text-ink">
        Source text:{" "}
        <a className="text-navy underline" href={SOURCE_URL}>
          {SOURCE_URL}
        </a>
        . Nothing about a visitor is written to disk.
      </p>

      <h2 className="mt-10 font-serif text-2xl text-navy">Missing credentials</h2>
      <p className="mt-3 text-ink">
        <code className="text-navy">POST /api/chat</code> returns{" "}
        <strong>503</strong> with <code className="text-navy">code: &quot;missing_api_key&quot;</code>{" "}
        until <code className="text-navy">OPENROUTER_API_KEY</code> is set. That is
        expected on a fresh deploy. Retrieval still runs in{" "}
        <code className="text-navy">npm test</code> without a key. On Vercel, add the
        key to the project’s environment for Production and Preview. This app is its
        own project, not a path on another site.
      </p>

      <h2 className="mt-10 font-serif text-2xl text-navy">Limits</h2>
      <p className="mt-3 text-ink">
        English only. One book. The model can still miss a passage that retrieval
        found, or refuse with <code className="text-navy">NOT_IN_BOOK</code> when the
        passages do not actually answer. A question that shares a word with the book,
        such as “queen,” may be sent to the model; the model is instructed to refuse
        if the passages do not contain the answer.
      </p>
    </article>
  );
}
