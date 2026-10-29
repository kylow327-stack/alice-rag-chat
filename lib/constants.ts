/**
 * Primary free chat model. Laguna S 2.1 and Gemma 4 31B free routes were
 * hitting the upstream shared pool (429). Nemotron Lightning still answered
 * at max_tokens 700.
 * https://openrouter.ai/models?q=free
 */
export const OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free";

/** At most two extra `:free` ids. OpenRouter allows three models in one call, including the primary. */
export const OPENROUTER_FALLBACK_MODELS = [
  "liquid/lfm-2.5-2.6b:free",
  "recursive/flint-v1.0:free",
] as const;

/** Second free-only trio, used once if the first call is rate-limited or empty. */
export const OPENROUTER_RETRY_MODEL = "dots-studio/dots-3-note-preview:free";

export const OPENROUTER_RETRY_FALLBACKS = [
  "cohere/north-mini-code:free",
  "google/gemma-4-31b-it:free",
] as const;

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Placeholder until the demo has a public URL. OpenRouter uses it for rankings. */
export const OPENROUTER_REFERER = "https://alice-rag.example";

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
