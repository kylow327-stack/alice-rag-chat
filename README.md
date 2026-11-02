# Alice — grounded chat

Public demo that answers questions from *Alice's Adventures in Wonderland* (Project Gutenberg eBook #11). Answers cite the passage they came from. If the question is not in the book, the app says so.

There is no upload and no sign-in. Chat is a separate Next.js app, meant to be deployed as its own Vercel project (not a page under another domain).

**Live demo:** https://alice-rag-chat.vercel.app · [Architecture page](https://alice-rag-chat.vercel.app/architecture)

## Stack

- Next.js App Router, TypeScript, Tailwind
- Retrieval: a committed local index (no embedding API)
- Generation: [OpenRouter](https://openrouter.ai/docs/quickstart) free models with automatic `:free` fallbacks, exponential backoff, and client-side retry

## Setup

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The architecture write-up is at `/architecture`.

`npm test` checks chunking, embeddings, and retrieval. It does not call OpenRouter.

`npm run build` compiles the app. It does not need a token and it does not re-download the book.

## Environment

Copy the example and set one variable:

```bash
cp .env.example .env.local
```

```
OPENROUTER_API_KEY=
```

Create a free key at [openrouter.ai/keys](https://openrouter.ai/keys). No other API keys are used. Retrieval does not call OpenRouter.

Without that variable, `POST /api/chat` returns **503**:

```json
{ "error": "OPENROUTER_API_KEY is not configured.", "code": "missing_api_key" }
```

That response is expected until the key is set. The chat page explains it.

### Vercel

Create a new project for this repo (its own app, not a subpath of another site).

1. Framework preset: Next.js. Build command: `npm run build`.
2. Environment variable: `OPENROUTER_API_KEY` for Production and Preview.
3. Redeploy after saving it.

Do not commit `.env.local`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Retrieval tests, no network, no OpenRouter key |
| `npm run lint` | ESLint |
| `npm run ingest` | Rebuild `data/` from Gutenberg and the embedding model |
| `npm run check:models` | Verify every configured free model id against OpenRouter's live catalog |

Ingest downloads the book and the Apache-2.0 embedding matrix into `.cache/` (gitignored), then rewrites the committed index. You do not need to run it to build or deploy; the index is already in the repo. Run it when you want to regenerate the chunks.

## How retrieval works

Chunks of the twelve chapters are stored in `data/alice-index.json` with precomputed vectors in `data/chunk-embeddings.f16`.

Embeddings are [sentence-transformers/static-retrieval-mrl-en-v1](https://huggingface.co/sentence-transformers/static-retrieval-mrl-en-v1): a static token table, mean-pooled with the bert-base-uncased tokenizer, truncated to 128 dimensions, then normalized. The server embeds a question with that same table. It does not load ONNX and it does not call an embedding API, so a cold start stays a file read plus a few hundred dot products. Regenerating the index with `npm run ingest` downloads the public weight file; chat never does.

Ranking is cosine similarity plus a lexical overlap bonus, so a name like "Tea-Party" is not lost to a vague neighbor. Low scores never call the model. Details and the exact model string are on the architecture page.

## Chat model

```
nvidia/nemotron-3.5-lightning:free
```

Four model trios are tried sequentially, spread across eight providers so each one hits a different rate-limit bucket on OpenRouter's free tier:

1. **Primary trio:** `nvidia/nemotron-3.5-lightning:free` → `liquid/lfm-2.5-2.6b:free` → `recursive/flint-v1.0:free`
2. **Retry trio:** `thinkingmachines/inkling:free` → `nvidia/nemotron-3-ultra-550b-a55b:free` → `xingchen-agi/xing4.0-29b-a4b:free`
3. **Third trio:** `google/gemma-4-31b-it:free` → `dots-studio/dots-3-note-preview:free` → `cohere/north-mini-code:free`
4. **Fourth trio:** `thinkingmachines/inkling-small:free` → `google/gemma-4-26b-a4b-it:free` → `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`

Between rounds, the server applies exponential backoff (2s → 4s → 8s) with random jitter (0–499ms) and respects the `Retry-After` header from 429 responses. A **404 means OpenRouter retired that model id** — it falls through to the next trio rather than failing the request. The client also auto-retries on 502 `provider_error` up to 3 times with its own backoff.

`POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer $OPENROUTER_API_KEY`. Headers sent on every call: `HTTP-Referer: https://alice-rag-chat.vercel.app/` and `X-Title: Alice RAG Chat`.

Every id ends in `:free`. The client rejects anything else, so a paid model is never a fallback. The only environment variable is `OPENROUTER_API_KEY`. Free routes share an upstream pool and often return 429; the four trios, backoff, and client retry are there so a busy model does not take the demo down.

### Checking model ids

OpenRouter retires free-tier models regularly, and a retired id returns 404. Run this before deploying or when chat starts failing:

```bash
npm run check:models
```

It compares every configured id against OpenRouter's live catalog and prints the free chat models that are not yet in the rotation. No API key needed. When it reports a retired id, pick a replacement from its list and update `lib/constants.ts`.

## Licenses

The novel is public domain. The index does not include the Project Gutenberg header, footer, or trademark.

`data/token-embeddings.f16` is a truncated, float16 copy of `sentence-transformers/static-retrieval-mrl-en-v1`. `data/vocab.txt` is the vocabulary from `google-bert/bert-base-uncased`. Both upstream models are Apache-2.0. The license text is in `licenses/APACHE-2.0.txt`.
