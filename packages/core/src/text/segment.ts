import { Parser, jaModel } from 'budoux';
import { baseLanguage } from './language';

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

let japaneseParser: Parser | undefined;

/**
 * Splits a line into word and non-word tokens. Uses the platform's
 * Unicode-aware segmenter, so languages written without spaces (Japanese,
 * Chinese, Thai) are split into words too. Joining all token texts
 * reproduces the input exactly.
 *
 * Japanese is split into phrases first (BudouX), and the words inside a phrase
 * are joined: the segmenter cuts verbs apart (帰 | って, 食 | べら | れ), so a
 * click would otherwise land on a fragment.
 */
export function tokenize(text: string, lang: string): Token[] {
  const japanese = baseLanguage(lang) === 'ja';
  const parts = japanese ? (japaneseParser ??= new Parser(jaModel)).parse(text) : [text];
  const tokens: Token[] = [];
  for (const part of parts) {
    let previous: Token | undefined;
    for (const { segment, isWordLike } of getSegmenter(lang).segment(part)) {
      const isWord = isWordLike === true && LETTER.test(segment);
      if (japanese && isWord && previous?.isWord) {
        previous.text += segment;
        continue;
      }
      previous = { text: segment, isWord };
      tokens.push(previous);
    }
  }
  return tokens;
}

/** The first word the platform's segmenter finds in `text`: a dictionary fallback for a clicked phrase. */
export function firstWord(text: string, lang: string): string {
  for (const { segment, isWordLike } of getSegmenter(lang).segment(text)) {
    if (isWordLike) return segment;
  }
  return text;
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
