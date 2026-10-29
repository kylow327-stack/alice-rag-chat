import type { ChunkRecord } from "./types";

const MAX_CHARS = 1400;

const ROMAN: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

export function romanToInt(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const current = ROMAN[value[i] ?? ""] ?? 0;
    const next = ROMAN[value[i + 1] ?? ""] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

/** Drop the Project Gutenberg header and footer. Keep the twelve chapters. */
export function extractBook(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const start = text.indexOf("*** START OF THE PROJECT GUTENBERG EBOOK");
  const end = text.indexOf("*** END OF THE PROJECT GUTENBERG EBOOK");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Project Gutenberg start/end markers were not found");
  }
  const body = text.slice(start, end);
  const firstChapter = body.search(/^CHAPTER\s+[IVXLCDM]+\.\s*$/m);
  if (firstChapter < 0) {
    throw new Error("No chapter headings found in the Gutenberg text");
  }
  let book = body.slice(firstChapter);
  const theEnd = book.search(/^THE END\s*$/m);
  if (theEnd >= 0) book = book.slice(0, theEnd);
  return book.replace(/_([^_\n]+)_/g, "$1");
}

function unwrapParagraph(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "[Illustration]");
  let text = "";
  for (const line of lines) {
    if (!text) {
      text = line;
      continue;
    }
    if (text.endsWith("-") && /^[a-z]/.test(line)) {
      text = text.slice(0, -1) + line;
    } else {
      text = `${text} ${line}`;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

function splitLong(paragraph: string): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > MAX_CHARS) {
      if (current) parts.push(current);
      for (let i = 0; i < sentence.length; i += MAX_CHARS) {
        const slice = sentence.slice(i, i + MAX_CHARS).trim();
        if (slice) parts.push(slice);
      }
      current = "";
      continue;
    }
    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= MAX_CHARS) {
      current = `${current} ${sentence}`;
    } else {
      parts.push(current);
      current = sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function packParagraphs(body: string): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(unwrapParagraph)
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > MAX_CHARS ? splitLong(paragraph) : [paragraph];
    for (const piece of pieces) {
      if (!current) {
        current = piece;
        continue;
      }
      if (current.length + 1 + piece.length <= MAX_CHARS) {
        current = `${current} ${piece}`;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Split an already-extracted book into citable chunks. */
export function chunkBook(book: string): ChunkRecord[] {
  const matches = [...book.matchAll(/^CHAPTER\s+([IVXLCDM]+)\.\s*$/gm)];
  const chunks: ChunkRecord[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (!match) continue;
    const roman = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[i + 1]?.index ?? book.length;
    const section = book.slice(start, next).replace(/^\n+/, "");
    const lines = section.split("\n");
    let title = `Chapter ${roman}`;
    let bodyStart = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]?.trim() ?? "";
      if (!line) continue;
      title = line;
      bodyStart = lineIndex + 1;
      break;
    }
    const number = romanToInt(roman);
    const parts = packParagraphs(lines.slice(bodyStart).join("\n"));
    parts.forEach((text, index) => {
      chunks.push({
        id: `ch${String(number).padStart(2, "0")}-p${String(index + 1).padStart(2, "0")}`,
        chapter: roman,
        chapterNumber: number,
        title,
        text,
      });
    });
  }
  return chunks;
}
