import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COSINE_WITHOUT_OVERLAP,
  EMBEDDING_DIM,
  LEXICAL_WEIGHT,
  SCORE_FLOOR,
  TOP_K,
} from "./constants";
import { embedText } from "./embeddings";
import { readFloat16 } from "./float16";
import type { AliceIndex, Citation, Hit } from "./types";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "to", "of",
  "in", "on", "at", "by", "for", "with", "from", "into", "over", "after",
  "before", "about", "as", "is", "am", "are", "was", "were", "be", "been",
  "being", "do", "does", "did", "doing", "have", "has", "had", "having", "it",
  "its", "this", "that", "these", "those", "what", "which", "who", "whom",
  "whose", "why", "how", "when", "where", "there", "here", "not", "no", "nor",
  "too", "very", "just", "only", "own", "same", "such", "can", "could",
  "should", "would", "will", "shall", "may", "might", "must", "also", "out",
  "up", "down", "off", "again", "once", "she", "her", "hers", "he", "him",
  "his", "they", "them", "their", "you", "your", "we", "our", "i", "me", "my",
  "mine", "because", "while", "during", "each", "few", "more", "most", "other",
  "some", "any", "all", "both", "between", "through", "above", "below", "under",
  "tell", "something", "anything", "please", "doesn", "isn", "wasn", "didn",
]);

type Corpus = {
  index: AliceIndex;
  vectors: Float32Array;
};

let corpus: Corpus | null = null;

export function loadCorpus(): Corpus {
  if (corpus) return corpus;
  const index = JSON.parse(
    readFileSync(path.join(process.cwd(), "data", "alice-index.json"), "utf8"),
  ) as AliceIndex;
  const vectors = readFloat16(path.join(process.cwd(), "data", "chunk-embeddings.f16"));
  const expected = index.chunks.length * EMBEDDING_DIM;
  if (vectors.length !== expected) {
    throw new Error(
      `chunk embeddings have ${vectors.length} values, expected ${expected}`,
    );
  }
  corpus = { index, vectors };
  return corpus;
}

function cosineRow(query: Float32Array, matrix: Float32Array, row: number): number {
  const offset = row * query.length;
  let sum = 0;
  for (let d = 0; d < query.length; d += 1) {
    sum += (query[d] ?? 0) * (matrix[offset + d] ?? 0);
  }
  return sum;
}

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordAppears(word: string, blob: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(blob);
}

export function search(query: string, k = TOP_K): Hit[] {
  const { index, vectors } = loadCorpus();
  const embedded = embedText(query);
  const words = contentWords(query);
  const scored = index.chunks.map((chunk, row) => {
    const score = cosineRow(embedded, vectors, row);
    const haystack = `${chunk.title}\n${chunk.text}`;
    const covered =
      words.length === 0
        ? 0
        : words.filter((word) => wordAppears(word, haystack)).length / words.length;
    return {
      chunk,
      score,
      hybrid: score + LEXICAL_WEIGHT * covered,
    };
  });
  scored.sort((a, b) => b.hybrid - a.hybrid);
  return scored.slice(0, k);
}

export type Assessment = {
  hits: Hit[];
  refused: boolean;
  reason: "empty" | "low_similarity" | "no_overlap" | "ok";
};

/**
 * Refuse when the book is a poor match. Content-word overlap keeps
 * oddly phrased but on-book questions, and blocks lookalike off-topic ones.
 */
export function assess(query: string): Assessment {
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], refused: true, reason: "empty" };
  const hits = search(trimmed);
  const best = hits[0];
  if (!best || best.hybrid < SCORE_FLOOR) {
    return { hits, refused: true, reason: "low_similarity" };
  }
  const words = contentWords(trimmed);
  if (words.length === 0) {
    if (best.score < COSINE_WITHOUT_OVERLAP) {
      return { hits, refused: true, reason: "no_overlap" };
    }
    return { hits, refused: false, reason: "ok" };
  }
  const haystack = hits.map((hit) => `${hit.chunk.title}\n${hit.chunk.text}`).join("\n");
  const overlap = words.some((word) => wordAppears(word, haystack));
  if (!overlap && best.score < COSINE_WITHOUT_OVERLAP) {
    return { hits, refused: true, reason: "no_overlap" };
  }
  return { hits, refused: false, reason: "ok" };
}

export function chapterLabel(hit: Hit): string {
  return `Chapter ${hit.chunk.chapter} · ${hit.chunk.title}`;
}

export function excerpt(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const slice = flat.slice(0, max);
  const punct = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (punct > 80) return slice.slice(0, punct + 1);
  const space = slice.lastIndexOf(" ");
  const cut = space > 40 ? space : max;
  return `${slice.slice(0, cut).trimEnd()}…`;
}

export function toCitation(hit: Hit): Citation {
  return {
    id: hit.chunk.id,
    chapter: chapterLabel(hit),
    quote: excerpt(hit.chunk.text),
    score: Number(hit.score.toFixed(3)),
  };
}
