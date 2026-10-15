import type { Cue } from '../subtitles/types';

/** Sentence-final punctuation, maybe followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?。！？…‼⁇][\s"'”’」』)）\]]*$/u;
/** Scripts written without spaces between words. */
const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

/** Joins two pieces of one sentence, with a space unless the script at the seam uses none. */
export function joinText(first: string, second: string): string {
  const a = first.trimEnd();
  const b = second.trimStart();
  if (!a || !b) return a + b;
  return NO_SPACE.test(a.at(-1)!) || NO_SPACE.test(b[0]!) ? a + b : `${a} ${b}`;
}

export interface SentenceOptions {
  /** Longest pause (seconds) inside one sentence. */
  gap?: number;
  /** Longest joined line, in seconds and characters, for speech without punctuation. */
  maxSeconds?: number;
  maxLength?: number;
}

/**
 * Speech engines cut lines at pauses, not at sentence ends, so fast speech gives sentence fragments that
 * translate badly on their own. Joins each line that doesn't end a sentence with the next one, if the
 * pause between them is short. Cues must be sorted; returns new cues.
 */
export function joinSentences(cues: readonly Cue[], { gap = 1, maxSeconds = 10, maxLength = 160 }: SentenceOptions = {}): Cue[] {
  const joined: Cue[] = [];
  for (const cue of cues) {
    const last = joined.at(-1);
    if (
      last &&
      !endsSentence(last.text) &&
      cue.start - last.end < gap &&
      cue.end - last.start <= maxSeconds &&
      last.text.length + cue.text.length <= maxLength
    ) {
      joined[joined.length - 1] = { start: last.start, end: Math.max(last.end, cue.end), text: joinText(last.text, cue.text) };
    } else joined.push({ ...cue });
  }
  return joined;
}
