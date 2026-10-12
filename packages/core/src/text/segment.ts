export interface Token {
  text: string;
  /** True for words the learner can click; false for spaces, punctuation and numbers. */
  isWord: boolean;
}

const segmenters = new Map<string, Intl.Segmenter>();

function getSegmenter(lang: string): Intl.Segmenter {
  let segmenter = segmenters.get(lang);
  if (!segmenter) {
    try {
      segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
    } catch {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
    segmenters.set(lang, segmenter);
  }
  return segmenter;
}

const LETTER = /\p{L}/u;

/**
 * Splits a line into word and non-word tokens. Uses the platform's
 * Unicode-aware segmenter, so languages written without spaces (Japanese,
 * Chinese, Thai) are split into words too. Joining all token texts
 * reproduces the input exactly.
 */
export function tokenize(text: string, lang: string): Token[] {
  const tokens: Token[] = [];
  for (const { segment, isWordLike } of getSegmenter(lang).segment(text)) {
    tokens.push({ text: segment, isWord: isWordLike === true && LETTER.test(segment) });
  }
  return tokens;
}

/** Form used for lookups and for de-duplicating saved words. */
export function normalizeWord(word: string, lang: string): string {
  let lower: string;
  try {
    lower = word.normalize('NFC').toLocaleLowerCase(lang);
  } catch {
    lower = word.normalize('NFC').toLowerCase();
  }
  return lower.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
