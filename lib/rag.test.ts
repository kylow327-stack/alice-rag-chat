import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkBook, extractBook } from "./chunk";
import { floatToHalf, halfToFloat } from "./float16";
import { tokenizeText, embedText } from "./embeddings";
import { isModelRefusal, retrievalQuery } from "./prompt";
import { answerFromPayload, extractFinalAnswer } from "./extract-answer";
import { assess, loadCorpus, search } from "./retrieve";
import {
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MODEL,
  OPENROUTER_RETRY_FALLBACKS,
  OPENROUTER_RETRY_MODEL,
} from "./constants";
import { assertFreeChatModels, OpenRouterError, openRouterConfigError } from "./openrouter";

const SAMPLE = `header
*** START OF THE PROJECT GUTENBERG EBOOK ALICE ***

 CHAPTER I.     Down the Rabbit-Hole

CHAPTER I.
Down the Rabbit-Hole

Alice saw a _very_ small rabbit.

CHAPTER II.
The Pool of Tears

She cried.

THE END

*** END OF THE PROJECT GUTENBERG EBOOK ALICE ***
license
`;

describe("chunking", () => {
  it("drops the Gutenberg frame and keeps chapter text", () => {
    const chunks = chunkBook(extractBook(SAMPLE));
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.id, "ch01-p01");
    assert.equal(chunks[0]?.title, "Down the Rabbit-Hole");
    assert.equal(chunks[0]?.text, "Alice saw a very small rabbit.");
    assert.equal(chunks[1]?.chapter, "II");
    assert.equal(chunks[1]?.chapterNumber, 2);
  });
});

describe("embeddings", () => {
  it("tokenizes like bert-base-uncased and returns a unit vector", () => {
    assert.deepEqual(tokenizeText("Hello"), ["[CLS]", "hello", "[SEP]"]);
    const pieces = tokenizeText("hatter");
    assert.ok(pieces.includes("[CLS]"));
    assert.equal(pieces.includes("[UNK]"), false);
    const vector = embedText("White Rabbit");
    assert.equal(vector.length, 128);
    let norm = 0;
    for (const value of vector) norm += value * value;
    assert.ok(Math.abs(norm - 1) < 1e-3);
  });

  it("round-trips ordinary float16 values", () => {
    for (const value of [0, 1, -1, 0.5, 1.5, 18.5]) {
      assert.equal(halfToFloat(floatToHalf(value)), value);
    }
  });
});

describe("retrieval", () => {
  it("loads a twelve-chapter index", () => {
    const { index } = loadCorpus();
    assert.equal(index.work, "Alice's Adventures in Wonderland");
    assert.ok(index.chunks.length > 50);
    assert.equal(new Set(index.chunks.map((chunk) => chunk.chapterNumber)).size, 12);
    assert.equal(
      index.chunks.some((chunk) => /project gutenberg license/i.test(chunk.text)),
      false,
    );
  });

  it("answers from the book and refuses questions outside it", () => {
    const rabbit = assess("Why does Alice follow the White Rabbit?");
    assert.equal(rabbit.refused, false);
    assert.equal(rabbit.hits[0]?.chunk.chapter, "I");
    assert.match(rabbit.hits[0]?.chunk.text ?? "", /[Rr]abbit/);

    const tea = assess("What happens at the Mad Tea-Party?");
    assert.equal(tea.refused, false);
    assert.equal(tea.hits[0]?.chunk.chapter, "VII");

    const roses = assess("Who painted the white roses red?");
    assert.equal(roses.refused, false);
    assert.equal(roses.hits[0]?.chunk.chapter, "VIII");

    const dinah = search("Who is Dinah?");
    assert.match(dinah.map((hit) => hit.chunk.text).join("\n"), /Dinah was the cat/i);

    assert.equal(assess("What is the capital of France?").refused, true);
    assert.equal(assess("How do I bake sourdough bread?").refused, true);
    assert.equal(assess("   ").refused, true);
  });
});

describe("OpenRouter config", () => {
  it("requires OPENROUTER_API_KEY", () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(openRouterConfigError(), "OPENROUTER_API_KEY is not configured.");
    process.env.OPENROUTER_API_KEY = "   ";
    assert.equal(openRouterConfigError(), "OPENROUTER_API_KEY is not configured.");
    process.env.OPENROUTER_API_KEY = "sk-or-v1-example";
    assert.equal(openRouterConfigError(), null);
    const routes = [
      [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS],
      [OPENROUTER_RETRY_MODEL, ...OPENROUTER_RETRY_FALLBACKS],
    ];
    assert.ok(OPENROUTER_FALLBACK_MODELS.length <= 2);
    assert.ok(OPENROUTER_RETRY_FALLBACKS.length <= 2);
    for (const ids of routes) {
      assert.ok(ids.length <= 3);
      assert.doesNotThrow(() => assertFreeChatModels(ids));
      for (const id of ids) {
        assert.match(id, /:free$/);
        assert.equal(id.includes("gpt-4o"), false);
      }
    }
    assert.throws(() => assertFreeChatModels(["openai/gpt-4o"]), OpenRouterError);
    assert.throws(() => assertFreeChatModels(["nvidia/nemotron-3.5-lightning"]), OpenRouterError);
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  });
});

describe("final answer extraction", () => {
  it("drops a thinking-process preamble and keeps the closing answer", () => {
    const raw = [
      "Here's a thinking process:",
      "",
      "1. Analyze User Input: The question is why Alice follows the rabbit.",
      "2. Check the passages: Passage 1 mentions curiosity.",
      "",
      "Final answer:",
      "Alice follows the White Rabbit because she is burning with curiosity.",
    ].join("\n");
    assert.equal(
      extractFinalAnswer(raw),
      "Alice follows the White Rabbit because she is burning with curiosity.",
    );
  });

  it("keeps the prose that follows numbered analysis when there is no answer label", () => {
    const raw = [
      "Here's a thinking process:",
      "",
      "1. Analyze User Input: why she follows him.",
      "2. Check the passages: curiosity on the bank.",
      "",
      "Alice follows the White Rabbit because she is burning with curiosity.",
    ].join("\n");
    assert.equal(
      extractFinalAnswer(raw),
      "Alice follows the White Rabbit because she is burning with curiosity.",
    );
  });

  it("leaves a normal answer unchanged and ignores a separate reasoning field", () => {
    assert.equal(
      extractFinalAnswer("NOT_IN_BOOK"),
      "NOT_IN_BOOK",
    );
    const payload = {
      choices: [
        {
          message: {
            content: "The gardeners painted the white roses red.",
            reasoning: "Here's a thinking process:\n1. Analyze User Input: roses.",
            reasoning_details: [{ text: "scratch" }],
          },
        },
      ],
    };
    assert.equal(answerFromPayload(payload), "The gardeners painted the white roses red.");
  });

  it("does not show reasoning when content is only scratchwork", () => {
    const payload = {
      choices: [
        {
          message: {
            content: "Here's a thinking process:\n1. Analyze User Input: nothing useful yet.",
            reasoning: "The Queen of Hearts painted them.",
          },
        },
      ],
    };
    assert.equal(answerFromPayload(payload), "");
  });
});

describe("prompt helpers", () => {
  it("detects the model refusal sentinel", () => {
    assert.equal(isModelRefusal("NOT_IN_BOOK"), true);
    assert.equal(isModelRefusal("  not_in_book. "), true);
    assert.equal(isModelRefusal("NOT_IN_BOOK but also an answer"), false);
  });

  it("folds a short follow-up into the previous question", () => {
    const query = retrievalQuery([
      { role: "user", content: "Who painted the roses red?" },
      { role: "assistant", content: "The gardeners did." },
      { role: "user", content: "Why?" },
    ]);
    assert.match(query, /roses/);
    assert.match(query, /Why\?/);
  });
});
