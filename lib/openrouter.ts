/**
 * This file is kept for backward compatibility.
 * The LLM provider logic has moved to lib/llm.ts, which implements a
 * multi-provider cascade (Mistral → Groq → OpenRouter).
 *
 * Existing imports of OpenRouterError, openRouterConfigError, assertFreeChatModels,
 * isRetryable, and completeChat from "./openrouter" still work via re-export.
 */

export {
  LLMError as OpenRouterError,
  llmConfigError as openRouterConfigError,
  assertFreeChatModels,
  isRetryable,
  completeChat,
} from "./llm";
