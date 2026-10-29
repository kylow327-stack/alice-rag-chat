import type { Metadata } from "next";
import {
  COSINE_WITHOUT_OVERLAP,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  GUTENBERG_ID,
  LEXICAL_WEIGHT,
  OPENROUTER_CHAT_URL,
  OPENROUTER_MODEL,
  OPENROUTER_REFERER,
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
    body: `Otherwise the passages and the question go to ${OPENROUTER_MODEL} on OpenRouter’s free tier. The reply is prose. Citations are the retrieved chunks — id, chapter, and a short quote — not spans invented by the model.`,
  },
];

export default function ArchitecturePage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-navy">How it works</p>
      <h1 className="mt-2 font-serif text-4xl text-navy sm:text-5xl">Architecture</h1>
      <p className="mt-4 text-lg text-ink-soft">
        A small retrieval-augmented chat over one public-domain book. There is no
        account, no file upload, and no hosted embedding API. Generation uses
        OpenRouter’s free tier.
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
          <dt className="text-sm font-semibold text-navy">Chat</dt>
          <dd className="mt-1 text-ink">
            <code className="bg-paper px-1.5 py-0.5 text-navy">{OPENROUTER_MODEL}</code>
            <span className="mt-2 block">
              <code className="text-navy">POST {OPENROUTER_CHAT_URL}</code> with{" "}
              <code className="text-navy">Authorization: Bearer $OPENROUTER_API_KEY</code>,{" "}
              <code className="text-navy">HTTP-Referer: {OPENROUTER_REFERER}</code>, and{" "}
              <code className="text-navy">X-Title: {OPENROUTER_TITLE}</code>. The referer is a
              placeholder until this demo has a public URL. Temperature is 0.2. The reply is
              the OpenAI-style <code className="text-navy">choices[0].message.content</code>.
            </span>
            <span className="mt-2 block">
              Checked against the OpenRouter catalog on 29 October 2026. No Llama or Qwen
              model id ending in <code className="text-navy">:free</code> was listed. Gemma 4
              31B Instruct was, with prompt and completion priced at zero, and reasoning off
              by default. If that id disappears, replace it with another{" "}
              <code className="text-navy">:free</code> chat model from the catalog.
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
