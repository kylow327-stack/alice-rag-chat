import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { chunkBook, extractBook } from "../lib/chunk";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  SOURCE_URL,
  TOKENIZER,
  VOCAB_SIZE,
  WORK_AUTHOR,
  WORK_TITLE,
} from "../lib/constants";
import { DATA_DIR, embedText } from "../lib/embeddings";
import { writeFloat16 } from "../lib/float16";
import { search } from "../lib/retrieve";
import type { AliceIndex } from "../lib/types";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, ".cache");
const BOOK_PATH = path.join(CACHE, "pg11.txt");
const VOCAB_CACHE = path.join(CACHE, "vocab.txt");
const WEIGHTS_PATH = path.join(CACHE, "model.safetensors");

const BOOK_URL = SOURCE_URL;
const VOCAB_URL =
  "https://huggingface.co/google-bert/bert-base-uncased/resolve/main/vocab.txt";
const WEIGHTS_URL =
  "https://huggingface.co/sentence-transformers/static-retrieval-mrl-en-v1/resolve/main/0_StaticEmbedding/model.safetensors";

const PROBES = [
  "Why does Alice follow the White Rabbit?",
  "What happens at the Mad Tea-Party?",
  "Who painted the white roses red?",
  "Where does the Cheshire Cat go?",
  "What is the capital of France?",
  "How do I bake sourdough bread?",
];

async function ensureFile(url: string, dest: string, minBytes: number) {
  if (existsSync(dest) && statSync(dest).size >= minBytes) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  const response = await fetch(url, {
    headers: { "User-Agent": "alice-rag-ingest/1.0 (portfolio demo; public-domain text)" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  if (statSync(dest).size < minBytes) {
    throw new Error(`Download for ${url} was smaller than expected`);
  }
}

function loadTokenMatrix(file: string): Float32Array {
  const buf = readFileSync(file);
  const headerLen = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString("utf8")) as {
    "embedding.weight"?: { dtype?: string; shape?: number[]; data_offsets?: number[] };
  };
  const tensor = header["embedding.weight"];
  if (!tensor || tensor.dtype !== "F32" || !tensor.shape || !tensor.data_offsets) {
    throw new Error("embedding.weight tensor was not found in the safetensors file");
  }
  const [rows, cols] = tensor.shape;
  if (rows !== VOCAB_SIZE || cols < EMBEDDING_DIM) {
    throw new Error(`unexpected embedding shape ${rows}x${cols}`);
  }
  const [start, end] = tensor.data_offsets;
  const raw = buf.subarray(8 + headerLen + start, 8 + headerLen + end);
  const copy = Buffer.alloc(raw.length);
  raw.copy(copy);
  const full = new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
  const truncated = new Float32Array(rows * EMBEDDING_DIM);
  for (let row = 0; row < rows; row += 1) {
    const src = row * cols;
    const dst = row * EMBEDDING_DIM;
    for (let dim = 0; dim < EMBEDDING_DIM; dim += 1) {
      const value = full[src + dim] ?? 0;
      if (!Number.isFinite(value)) throw new Error(`non-finite weight at ${row},${dim}`);
      truncated[dst + dim] = value;
    }
  }
  return truncated;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  await ensureFile(BOOK_URL, BOOK_PATH, 100_000);
  await ensureFile(VOCAB_URL, VOCAB_CACHE, 100_000);
  await ensureFile(WEIGHTS_URL, WEIGHTS_PATH, 100_000_000);

  const matrix = loadTokenMatrix(WEIGHTS_PATH);
  writeFloat16(path.join(DATA_DIR, "token-embeddings.f16"), matrix);
  copyFileSync(VOCAB_CACHE, path.join(DATA_DIR, "vocab.txt"));
  writeFileSync(
    path.join(DATA_DIR, "embed-meta.json"),
    `${JSON.stringify(
      {
        model: EMBEDDING_MODEL,
        tokenizer: TOKENIZER,
        vocabSize: VOCAB_SIZE,
        dim: EMBEDDING_DIM,
        dtype: "float16",
        pooling: "mean",
        normalize: true,
        specialTokens: ["[CLS]", "[SEP]"],
        truncation:
          "First 128 dimensions. Mean-pooling commutes with truncation, so this matches Matryoshka truncate_dim=128.",
        license: "Apache-2.0",
      },
      null,
      2,
    )}\n`,
  );

  const book = extractBook(readFileSync(BOOK_PATH, "utf8"));
  const chunks = chunkBook(book);
  if (chunks.length < 40) throw new Error(`only produced ${chunks.length} chunks`);
  const chapters = new Set(chunks.map((chunk) => chunk.chapterNumber));
  if (chapters.size !== 12) throw new Error(`expected 12 chapters, found ${chapters.size}`);

  const vectors = new Float32Array(chunks.length * EMBEDDING_DIM);
  for (let i = 0; i < chunks.length; i += 1) {
    const vector = embedText(chunks[i]?.text ?? "");
    vectors.set(vector, i * EMBEDDING_DIM);
  }
  writeFloat16(path.join(DATA_DIR, "chunk-embeddings.f16"), vectors);

  const index: AliceIndex = {
    work: WORK_TITLE,
    author: WORK_AUTHOR,
    source: "Project Gutenberg eBook #11",
    sourceUrl: SOURCE_URL,
    rights:
      "The narrative is public domain. The Project Gutenberg header, footer, and trademark are not included.",
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    chunks,
  };
  writeFileSync(path.join(DATA_DIR, "alice-index.json"), `${JSON.stringify(index, null, 2)}\n`);

  console.log(`chunks ${chunks.length} dim ${EMBEDDING_DIM}`);
  for (const probe of PROBES) {
    const hits = search(probe, 3);
    console.log(`\nQ: ${probe}`);
    for (const hit of hits) {
      console.log(
        `  ${hit.score.toFixed(3)} ch ${hit.chunk.chapter} ${hit.chunk.id} ${hit.chunk.title}: ${hit.chunk.text.slice(0, 90)}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
