const MAX_WORD_CHARS = 100;

function isWhitespace(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  if (cp === 9 || cp === 10 || cp === 13 || cp === 32) return true;
  return /\p{Z}/u.test(char);
}

function isControl(char: string): boolean {
  if (isWhitespace(char)) return false;
  return /\p{C}/u.test(char);
}

function isPunctuation(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  if (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126)
  ) {
    return true;
  }
  return /\p{P}/u.test(char);
}

/** BERT basic cleanup: drop controls, collapse whitespace. */
export function cleanText(text: string): string {
  let out = "";
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp === 0 || cp === 0xfffd || isControl(char)) continue;
    out += isWhitespace(char) ? " " : char;
  }
  return out;
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

function splitPunctuation(word: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    if (isPunctuation(char)) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      pieces.push(char);
    } else {
      current += char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Lowercase WordPiece pre-tokenization matching bert-base-uncased. */
export function basicTokenize(text: string): string[] {
  const cleaned = stripAccents(cleanText(text).toLowerCase());
  const words = cleaned.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  for (const word of words) {
    pieces.push(...splitPunctuation(word));
  }
  return pieces;
}

function wordPiece(word: string, vocab: Map<string, number>): string[] {
  if ([...word].length > MAX_WORD_CHARS) return ["[UNK]"];
  const pieces: string[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let found: string | null = null;
    while (start < end) {
      const slice = word.slice(start, end);
      const candidate = start === 0 ? slice : `##${slice}`;
      if (vocab.has(candidate)) {
        found = candidate;
        break;
      }
      end -= 1;
    }
    if (!found) return ["[UNK]"];
    pieces.push(found);
    start = end;
  }
  return pieces;
}

/**
 * BERT uncased tokens for one string, including [CLS] and [SEP].
 * The static embedding model mean-pools these ids, specials included.
 */
export function tokenize(text: string, vocab: Map<string, number>): string[] {
  const tokens = ["[CLS]"];
  for (const word of basicTokenize(text)) {
    tokens.push(...wordPiece(word, vocab));
  }
  tokens.push("[SEP]");
  return tokens;
}
