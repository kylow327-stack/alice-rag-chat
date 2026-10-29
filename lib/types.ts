export type ChunkRecord = {
  id: string;
  chapter: string;
  chapterNumber: number;
  title: string;
  text: string;
};

export type AliceIndex = {
  work: string;
  author: string;
  source: string;
  sourceUrl: string;
  rights: string;
  embeddingModel: string;
  embeddingDim: number;
  chunks: ChunkRecord[];
};

export type Citation = {
  id: string;
  chapter: string;
  quote: string;
  score: number;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelMessage = {
  role: "system" | ChatRole;
  content: string;
};

export type ChatSuccess = {
  answer: string;
  refused: boolean;
  citations: Citation[];
};

export type Hit = {
  chunk: ChunkRecord;
  /** Cosine similarity of the static embedding. */
  score: number;
  /** Cosine plus a lexical overlap bonus. Used for ranking and the refusal gate. */
  hybrid: number;
};
