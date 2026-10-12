import { tokenize } from '../text/segment';

/** A live line split by how sure the recogniser is. `settled` and `translatable` are prefixes of `text`. */
export interface LiveText {
  text: string;
  /** Words that stayed the same across two updates (or everything, once the line is final). */
  settled: string;
  /** `settled` without its last few words: the part worth sending to a translator. */
  translatable: string;
}

/** Characters of the longest common prefix of two token lists, compared token by token. */
function agreedLength(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Splits the hypotheses of a line being recognised into settled and provisional text (the
 * LocalAgreement idea: a word is settled once two updates in a row agree on it). A settled prefix
 * never shrinks unless a later hypothesis contradicts it. Feed one line at a time; `final` ends it.
 */
export class LiveLine {
  private previous: string[] = [];
  private settledCount = 0;

  constructor(
    private readonly lang: string,
    /** Settled words held back from `translatable`, since the sentence may still change their translation. */
    private readonly holdBack = 2,
  ) {}

  update(text: string, final = false): LiveText {
    const tokens = tokenize(text, this.lang);
    const parts = tokens.map((token) => token.text);
    let count = final ? parts.length : agreedLength(this.previous, parts);
    // A hypothesis that still starts with what was settled keeps it, even if the last update disagreed.
    if (!final && this.settledCount <= parts.length && agreedLength(this.previous.slice(0, this.settledCount), parts) === this.settledCount) {
      count = Math.max(count, this.settledCount);
    }
    this.previous = parts;
    this.settledCount = count;

    // Never end the settled text mid-way through a word's trailing space or punctuation.
    let keep = count;
    let words = 0;
    if (!final) {
      for (let i = count - 1; i >= 0 && words < this.holdBack; i--) {
        if (tokens[i]!.isWord) words++;
        keep = i;
      }
      if (words < this.holdBack) keep = 0;
    }
    return {
      text,
      settled: parts.slice(0, count).join(''),
      translatable: parts.slice(0, keep).join('').trimEnd(),
    };
  }

  reset(): void {
    this.previous = [];
    this.settledCount = 0;
  }
}
