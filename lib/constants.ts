/**
 * Free chat models on OpenRouter, grouped into trios for sequential retry.
 * Each trio is tried in order; within a trio, OpenRouter's "models" array
 * lets the platform pick the first available one.
 *
 * Provider diversity matters: when the shared free pool is rate-limited,
 * spreading across different providers (Nvidia, Liquid, Google, Thinking Machines,
 * Xingchen, Recursive, Cohere, Dots Studio) gives each trio a better chance of
 * landing on a different rate-limit bucket.
 *
 * The free tier rotates models often. Every id below was checked against
 * https://openrouter.ai/api/v1/models on 3 Nov 2026. `npm run check:models`
 * re-checks them against the live catalog and fails if any id has been retired.
 *
 * https://openrouter.ai/models?q=free
 */
export const OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free";

/** At most two extra `:free` ids. OpenRouter allows three models in one call, including the primary. */
export const OPENROUTER_FALLBACK_MODELS = [
  "liquid/lfm-2.5-2.6b:free",
  "recursive/flint-v1.0:free",
] as const;

/** Second free-only trio, used if the first call is rate-limited or empty. */
export const OPENROUTER_RETRY_MODEL = "thinkingmachines/inkling:free";

export const OPENROUTER_RETRY_FALLBACKS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "xingchen-agi/xing4.0-29b-a4b:free",
] as const;

/** Third free-only trio, used if the first two are both rate-limited. */
export const OPENROUTER_RETRY2_MODEL = "google/gemma-4-31b-it:free";

export const OPENROUTER_RETRY2_FALLBACKS = [
  "dots-studio/dots-3-note-preview:free",
  "cohere/north-mini-code:free",
] as const;

/** Fourth free-only trio — the last line of defence before giving up. */
export const OPENROUTER_RETRY3_MODEL = "thinkingmachines/inkling-small:free";

export const OPENROUTER_RETRY3_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
] as const;

/**
 * Every free model id the app may call, in the order it is tried.
 * Used by the model-catalog check to fail loudly when an id has been retired
 * instead of letting it 404 at request time.
 */
export const OPENROUTER_ALL_MODELS = [
  OPENROUTER_MODEL,
  ...OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_RETRY_MODEL,
  ...OPENROUTER_RETRY_FALLBACKS,
  OPENROUTER_RETRY2_MODEL,
  ...OPENROUTER_RETRY2_FALLBACKS,
  OPENROUTER_RETRY3_MODEL,
  ...OPENROUTER_RETRY3_FALLBACKS,
] as const;

/** Base delay (ms) between model-trio retries. Doubles each round. */
export const OPENROUTER_BACKOFF_BASE_MS = 2_000;

/** Maximum delay between retries (ms). */
export const OPENROUTER_BACKOFF_MAX_MS = 16_000;

/** How many model-trio rounds to attempt before giving up. */
export const OPENROUTER_MAX_ROUNDS = 4;

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The demo's public URL. OpenRouter uses it for rankings. */
export const OPENROUTER_REFERER = "https://alice-rag-chat.vercel.app/";

export const OPENROUTER_TITLE = "Alice RAG Chat";

/** Static English retrieval model. Weights are truncated and committed. */
export const EMBEDDING_MODEL = "sentence-transformers/static-retrieval-mrl-en-v1";

export const TOKENIZER = "google-bert/bert-base-uncased";

/** Matryoshka truncation. Mean-pool then truncate matches truncate-then-mean. */
export const EMBEDDING_DIM = 128;

export const VOCAB_SIZE = 30522;

export const TOP_K = 5;

/**
 * Added to cosine for each fraction of the question's content words that
 * appear in a chunk (title included). Static vectors under-rank names like
 * "Tea-Party"; the bonus keeps those passages on top.
 */
export const LEXICAL_WEIGHT = 0.4;

/**
 * Best hybrid score below this is treated as off-book.
 * Tuned on the committed index: on-book questions land above it, and
 * questions from outside the book land below it.
 */
export const SCORE_FLOOR = 0.4;

/**
 * A purely semantic match with no shared content words must be this strong
 * before the chat model is called.
 */
export const COSINE_WITHOUT_OVERLAP = 0.62;

export const WORK_TITLE = "Alice's Adventures in Wonderland";

export const WORK_AUTHOR = "Lewis Carroll";

export const SOURCE_URL = "https://www.gutenberg.org/cache/epub/11/pg11.txt";

export const GUTENBERG_ID = 11;
