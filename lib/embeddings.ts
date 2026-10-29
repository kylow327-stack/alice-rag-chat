import { readFileSync } from "node:fs";
import path from "node:path";
import { EMBEDDING_DIM, VOCAB_SIZE } from "./constants";
import { readFloat16 } from "./float16";
import { tokenize } from "./tokenize";

export const DATA_DIR = path.join(process.cwd(), "data");

type Table = {
  vocab: Map<string, number>;
  weights: Float32Array;
  dim: number;
};

let table: Table | null = null;

export function loadVocab(): Map<string, number> {
  const lines = readFileSync(path.join(process.cwd(), "data", "vocab.txt"), "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== VOCAB_SIZE) {
    throw new Error(`vocab.txt has ${lines.length} tokens, expected ${VOCAB_SIZE}`);
  }
  const vocab = new Map<string, number>();
  lines.forEach((token, index) => {
    vocab.set(token, index);
  });
  return vocab;
}

function loadTable(): Table {
  if (table) return table;
  const vocab = loadVocab();
  const weights = readFloat16(path.join(process.cwd(), "data", "token-embeddings.f16"));
  const dim = EMBEDDING_DIM;
  if (weights.length !== vocab.size * dim) {
    throw new Error(
      `token embeddings have ${weights.length} values, expected ${vocab.size * dim}`,
    );
  }
  table = { vocab, weights, dim };
  return table;
}

export function tokenizeText(text: string): string[] {
  return tokenize(text, loadTable().vocab);
}

function tokenIds(text: string, vocab: Map<string, number>): number[] {
  const unk = vocab.get("[UNK]");
  if (unk === undefined) throw new Error("vocab is missing [UNK]");
  return tokenize(text, vocab).map((token) => vocab.get(token) ?? unk);
}

/** Mean-pool token vectors, then L2-normalize. Matches the committed chunk index. */
export function embedText(text: string): Float32Array {
  const { vocab, weights, dim } = loadTable();
  const ids = tokenIds(text, vocab);
  const acc = new Float64Array(dim);
  for (const id of ids) {
    const offset = id * dim;
    for (let d = 0; d < dim; d += 1) acc[d] += weights[offset + d] ?? 0;
  }
  const inv = 1 / ids.length;
  const out = new Float32Array(dim);
  let norm = 0;
  for (let d = 0; d < dim; d += 1) {
    const value = acc[d] * inv;
    out[d] = value;
    norm += value * value;
  }
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let d = 0; d < dim; d += 1) out[d] *= scale;
  return out;
}
