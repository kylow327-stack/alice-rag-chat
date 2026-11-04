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
    "How the Alice RAG chatbot works: hybrid retrieval over a pre-computed corpus, a three-provider LLM cascade (DeepSeek → Groq → OpenRouter), and grounded answers with citations.",
};

/* ─── SVG palette (matches globals.css design tokens) ─────────────────── */
const C = {
  paper: "#f3eee4",
  paperRaised: "#fffaf3",
  ink: "#1a1814",
  inkSoft: "#4e483f",
  navy: "#1b365d",
  navyDeep: "#12243f",
  signal: "#c2410c",
  signalSoft: "#fde8df",
  line: "#e3d8c8",
  teal: "#0d7570",
  tealSoft: "#d4f0ee",
  purple: "#5b2c8a",
  purpleSoft: "#ece0f5",
};

/* ─── Stage facts ──────────────────────────────────────────────────────── */
const STAGE_FACTS: {
  number: string;
  title: string;
  color: string;
  facts: [string, string][];
}[] = [
  {
    number: "1",
    title: "Client",
    color: C.navy,
    facts: [
      ["Framework", "Next.js 16 · App Router · Tailwind v4"],
      ["Components", "ChatPanel · VisitCounter · SiteHeader"],
      ["Message trim", "Last 8 turns sent to server"],
      ["Auto-retry", "Up to 3 attempts, exponential backoff"],
      ["Visit counter", "Abacus API, no signup required"],
    ],
  },
  {
    number: "2",
    title: "API Layer",
    color: C.teal,
    facts: [
      ["Routes", "/api/chat · /api/visits"],
      ["Message handling", "Graceful truncation to last 8"],
      ["Char limit", "2000 per message"],
      ["Response cache", "5-min TTL, 64-entry LRU"],
      ["Dynamic rendering", "connection() from next/server"],
    ],
  },
  {
    number: "3",
    title: "Retrieval",
    color: C.purple,
    facts: [
      ["Embedding model", EMBEDDING_MODEL],
      ["Dimensions", `${EMBEDDING_DIM} (Matryoshka truncation)`],
      ["Corpus", "119 chunks across 12 chapters"],
      ["Max chunk size", "1400 chars, paragraph-aware"],
      ["Hybrid scoring", `cosine + ${LEXICAL_WEIGHT} × word coverage`],
      ["Refusal gate", `Score floor ${SCORE_FLOOR} · cosine-no-overlap ${COSINE_WITHOUT_OVERLAP}`],
      ["Pipeline", "BERT tokenize → mean-pool → L2-normalize"],
      ["Storage", "Pre-computed .f16 + .json, committed to repo"],
    ],
  },
  {
    number: "4",
    title: "LLM Cascade",
    color: C.signal,
    facts: [
      ["Primary", `DeepSeek (${DEEPSEEK_MODEL}, $0.14/M input)`],
      ["Secondary", `Groq (${GROQ_MODEL}, free)`],
      ["Fallback", "OpenRouter — 4 trios, 12 free models, 8 providers"],
      ["Backoff", "2s → 4s → 8s + jitter, Retry-After aware"],
      ["Timeout", "90s per request"],
    ],
  },
  {
    number: "5",
    title: "Response",
    color: C.navyDeep,
    facts: [
      ["Refusal label", "NOT IN THE BOOK"],
      ["Citations", "Chapter + title + excerpt per passage"],
      ["Caching", "Refusals and answers both cached"],
      ["Delivery", "JSON to client, rendered with passage links"],
    ],
  },
];

/* ─── Detailed text steps ──────────────────────────────────────────────── */
const STEPS = [
  {
    title: "Corpus",
    body: `The ingest script downloads Project Gutenberg eBook #${GUTENBERG_ID} and keeps the twelve chapters. The Gutenberg header, footer, and license are not stored.`,
  },
  {
    title: "Chunks",
    body: "Paragraphs are unwrapped and packed to about 1,400 characters, still inside a chapter. Each chunk has an id such as ch07-p06. The corpus is 119 chunks.",
  },
  {
    title: "Local embeddings",
    body: `Token vectors come from ${EMBEDDING_MODEL}, mean-pooled with the ${TOKENIZER} WordPiece tokenizer, then cut to the first ${EMBEDDING_DIM} Matryoshka dimensions and L2-normalized. Ingest writes them once. The server does not call an embedding API and does not load a transformer.`,
  },
  {
    title: "Retrieve",
    body: `A question is embedded the same way. Chunks are ranked by cosine plus ${LEXICAL_WEIGHT} times the share of the question\u2019s content words found in the chunk, including its chapter title. The lexical term keeps names like \u201cTea-Party\u201d from being outranked by a vague semantic neighbor. The top ${TOP_K} chunks are the context.`,
  },
  {
    title: "Refuse",
    body: `If the best hybrid score is below ${SCORE_FLOOR}, or the passages share no content words with the question and the cosine is below ${COSINE_WITHOUT_OVERLAP}, the route does not call the model. It returns a plain refusal. If the model itself answers NOT_IN_BOOK, the same refusal is shown and the citations are dropped.`,
  },
  {
    title: "Generate",
    body: `Otherwise the passages and the question go to a multi-provider LLM cascade. DeepSeek is tried first (${DEEPSEEK_MODEL} via ${DEEPSEEK_CHAT_URL}); if it is unavailable, Groq is tried next (${GROQ_MODEL} via ${GROQ_CHAT_URL}); if both are busy, OpenRouter's free-tier rotation kicks in as the last resort. All three are OpenAI-compatible. The reply is prose. Citations are the retrieved chunks \u2014 id, chapter, and a short quote \u2014 not spans invented by the model.`,
  },
];

/* ─── SVG diagram component ────────────────────────────────────────────── */
function StageBox({
  x,
  y,
  w,
  h,
  color,
  soft,
  number,
  title,
  lines,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  soft: string;
  number: string;
  title: string;
  lines: string[];
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill={soft} stroke={color} strokeWidth="2.5" />
      <text x={x + 15} y={y + 25} fontSize="11" fontWeight="bold" fill={color}>
        {number} · {title}
      </text>
      <text x={x + 15} y={y + 50} fontSize="12" fill={C.ink}>
        {lines.map((line, i) => (
          <tspan key={i} x={x + 15} dy={i === 0 ? 0 : 22}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="mt-8 overflow-x-auto">
      <svg
        viewBox="0 0 900 640"
        className="w-full min-w-[700px]"
        role="img"
        aria-label="Alice RAG chatbot architecture diagram showing five stages: Client, API Layer, Retrieval, LLM Cascade, and Response"
      >
        {/* Background */}
        <rect width="900" height="640" rx="12" fill={C.paperRaised} />

        {/* Title */}
        <text x="450" y="30" textAnchor="middle" fontSize="14" fontWeight="bold" fill={C.navy}>
          Alice RAG — Full Request Flow
        </text>
        <text x="450" y="46" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          user question → grounded answer (or refusal)
        </text>

        {/* Flow arrows (top row) */}
        <g stroke={C.line} strokeWidth="2" fill="none" markerEnd="url(#arrow)">
          <line x1="250" y1="100" x2="330" y2="100" />
          <line x1="570" y1="100" x2="650" y2="100" />
        </g>
        <defs>
          <marker
            id="arrow"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L8,3 z" fill={C.line} />
          </marker>
        </defs>

        {/* Stage 1: Client */}
        <StageBox
          x={20}
          y={60}
          w={230}
          h={150}
          color={C.navy}
          soft={C.paper}
          number="1"
          title="CLIENT"
          lines={[
            "Next.js 16 · App Router",
            "ChatPanel · VisitCounter",
            "Trims to last 8 turns",
            "Auto-retry ×3, backoff",
          ]}
        />

        {/* Stage 2: API Layer */}
        <StageBox
          x={340}
          y={60}
          w={230}
          h={150}
          color={C.teal}
          soft={C.tealSoft}
          number="2"
          title="API LAYER"
          lines={[
            "/api/chat · /api/visits",
            "5-min LRU cache (64)",
            "Truncates to last 8 msgs",
            "2000-char limit",
          ]}
        />

        {/* Stage 3: Retrieval */}
        <StageBox
          x={660}
          y={60}
          w={230}
          h={150}
          color={C.purple}
          soft={C.purpleSoft}
          number="3"
          title="RETRIEVAL"
          lines={[
            "119 chunks · 12 chapters",
            "128-dim Matryoshka vectors",
            "cosine + 0.4 × word overlap",
            `Score floor ${SCORE_FLOOR} · gate ${COSINE_WITHOUT_OVERLAP}`,
          ]}
        />

        {/* Down arrow from API to embedding */}
        <g stroke={C.line} strokeWidth="2" fill="none" markerEnd="url(#arrow)">
          <line x1="450" y1="210" x2="450" y2="245" />
        </g>

        {/* Embedding pipeline box */}
        <g>
          <rect
            x={250}
            y={250}
            width={400}
            height={120}
            rx="10"
            fill={C.purpleSoft}
            stroke={C.purple}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          <text x="450" y="275" textAnchor="middle" fontFamily="monospace" fontSize="13" fontWeight="bold" fill={C.purple}>
            embedText(query)
          </text>
          <text x="270" y="302" fontSize="12" fill={C.ink}>
            <tspan fontWeight="bold" fill={C.purple}>1.</tspan> BERT tokenize
            <tspan x="270" dy="20">
              <tspan fontWeight="bold" fill={C.purple}>2.</tspan> Mean-pool token vectors
            </tspan>
            <tspan x="270" dy="20">
              <tspan fontWeight="bold" fill={C.purple}>3.</tspan> L2-normalize → 128-dim query vector
            </tspan>
            <tspan x="270" dy="20" fill={C.inkSoft} fontSize="11">
              static-retrieval-mrl-en-v1 · pre-computed corpus: .f16 + .json
            </tspan>
          </text>
        </g>

        {/* Down arrow from embedding to assess */}
        <g stroke={C.line} strokeWidth="2" fill="none" markerEnd="url(#arrow)">
          <line x1="450" y1="370" x2="450" y2="405" />
        </g>

        {/* assess() box */}
        <g>
          <rect x={250} y={410} width={400} height={100} rx="10" fill={C.signalSoft} stroke={C.signal} strokeWidth="2" />
          <text x="450" y="435" textAnchor="middle" fontFamily="monospace" fontSize="13" fontWeight="bold" fill={C.signal}>
            assess(query)
          </text>
          <text x="270" y="460" fontSize="12" fill={C.ink}>
            <tspan>hybrid &lt; {SCORE_FLOOR} → refuse (&quot;NOT IN THE BOOK&quot;)</tspan>
            <tspan x="270" dy="18">
              no overlap + cosine &lt; {COSINE_WITHOUT_OVERLAP} → refuse
            </tspan>
            <tspan x="270" dy="18" fill={C.inkSoft}>
              otherwise → top-{TOP_K} passages + citations
            </tspan>
          </text>
        </g>

        {/* Arrows from assess to LLM and Response */}
        <g stroke={C.line} strokeWidth="2" fill="none" markerEnd="url(#arrow)">
          <line x1="250" y1="460" x2="230" y2="460" />
          <line x1="650" y1="460" x2="660" y2="460" />
        </g>

        {/* Stage 4: LLM Cascade */}
        <g>
          <rect x={20} y={410} width={210} height={130} rx="10" fill={C.signalSoft} stroke={C.signal} strokeWidth="2.5" />
          <text x="35" y="435" fontSize="11" fontWeight="bold" fill={C.signal}>
            4 · LLM CASCADE
          </text>
          <text x="35" y="460" fontSize="12" fill={C.ink}>
            <tspan fontWeight="bold" fill={C.signal}>{"\u2460"}</tspan> DeepSeek $0.14/M
            <tspan x="35" dy="18">
              <tspan fontWeight="bold" fill={C.signal}>{"\u2461"}</tspan> Groq (free, 30 RPM)
            </tspan>
            <tspan x="35" dy="18">
              <tspan fontWeight="bold" fill={C.signal}>{"\u2462"}</tspan> OpenRouter 4-trio
            </tspan>
            <tspan x="35" dy="18" fill={C.inkSoft} fontSize="11">
              12 models · 8 providers
            </tspan>
          </text>
        </g>

        {/* Stage 5: Response */}
        <g>
          <rect x={660} y={410} width={210} height={130} rx="10" fill={C.paper} stroke={C.navyDeep} strokeWidth="2.5" />
          <text x="675" y="435" fontSize="11" fontWeight="bold" fill={C.navyDeep}>
            5 · RESPONSE
          </text>
          <text x="675" y="460" fontSize="12" fill={C.ink}>
            <tspan>Answer + citations</tspan>
            <tspan x="675" dy="18">or NOT IN THE BOOK</tspan>
            <tspan x="675" dy="18" fill={C.inkSoft} fontSize="11">
              Cached 5-min TTL
            </tspan>
            <tspan x="675" dy="16" fill={C.inkSoft} fontSize="11">
              JSON → client render
            </tspan>
          </text>
        </g>

        {/* Bottom annotations */}
        <text x="125" y="560" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          backoff: 2s → 4s → 8s + jitter
        </text>
        <text x="125" y="575" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          Retry-After aware · 90s timeout
        </text>
        <text x="450" y="570" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          Built by Rick Low, 2026
        </text>
        <text x="765" y="560" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          passage citations:
        </text>
        <text x="765" y="575" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          id · chapter · excerpt
        </text>

        {/* Bottom label */}
        <text x="450" y="620" textAnchor="middle" fontSize="11" fill={C.inkSoft}>
          corpus: Alice&apos;s Adventures in Wonderland · Project Gutenberg #11 · public domain
        </text>
      </svg>
    </div>
  );
}

/* ─── Stage detail section ─────────────────────────────────────────────── */
function StageSection({
  number,
  title,
  color,
  facts,
}: {
  number: string;
  title: string;
  color: string;
  facts: [string, string][];
}) {
  return (
    <div className="border-l-4 pl-5" style={{ borderColor: color }}>
      <h2 className="flex items-center gap-3 font-serif text-2xl text-navy">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {number}
        </span>
        {title}
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-sm">
            <dt className="font-semibold text-ink-soft whitespace-nowrap">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */
export default function ArchitecturePage() {
  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-navy">
        Under the hood
      </p>
      <h1 className="mt-2 font-serif text-4xl text-navy sm:text-5xl">Architecture</h1>
      <p className="mt-3 max-w-2xl text-base text-ink-soft">
        A small retrieval-augmented chat over one public-domain book. Every
        question flows through five stages: a trimmed client payload, a cached
        API route, hybrid retrieval over a pre-computed corpus, a three-provider
        LLM cascade, and a grounded response with citations. All numbers below
        are from the committed source code.
      </p>

      {/* Visual diagram */}
      <ArchitectureDiagram />

      {/* Stage fact sheets */}
      <section className="mt-12 space-y-8">
        {STAGE_FACTS.map((stage) => (
          <StageSection key={stage.number} {...stage} />
        ))}
      </section>

      {/* Detailed text walkthrough */}
      <h2 className="mt-12 font-serif text-2xl text-navy">Step-by-step walkthrough</h2>
      <ol className="mt-4 flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="border border-line bg-paper-raised px-4 py-3">
            <h3 className="font-serif text-xl text-navy">
              {index + 1}. {step.title}
            </h3>
            <p className="mt-1 text-ink">{step.body}</p>
          </li>
        ))}
      </ol>

      {/* Provider details */}
      <h2 className="mt-10 font-serif text-2xl text-navy">Provider cascade</h2>
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
              or initialize ONNX. Retrieval does not call any external API.
            </span>
          </dd>
        </div>
      </dl>

      {/* Stored files */}
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

      {/* Limits */}
      <h2 className="mt-10 font-serif text-2xl text-navy">Limits</h2>
      <p className="mt-3 text-ink">
        English only. One book. The model can still miss a passage that retrieval
        found, or refuse with <code className="text-navy">NOT_IN_BOOK</code> when the
        passages do not actually answer. A question that shares a word with the book,
        such as &ldquo;queen,&rdquo; may be sent to the model; the model is instructed to refuse
        if the passages do not contain the answer.
      </p>
    </article>
  );
}
