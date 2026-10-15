/** A piece of a word: plain text, or text with its reading written above it (furigana). */
export interface RubyPart {
  text: string;
  ruby?: string;
}

/** A word as a tokenizer reports it; `reading` is katakana (or hiragana) when it knows one. */
export interface ReadingToken {
  surface: string;
  reading?: string;
  /** How it's said, where that differs from the spelling (the particle は: ワ). */
  pronunciation?: string;
}

/** Where a reading goes in a line: `text.slice(start, end)` is written with `ruby` above it. */
export interface RubySpan {
  start: number;
  end: number;
  ruby: string;
}

const HAN = /\p{Script=Han}/u;

const toHiragana = (text: string) =>
  text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));

/**
 * Puts the reading over the kanji of `surface` only, not over the kana around them:
 * 食べ + タベ gives 食 (た) and べ. Kana inside a kanji run stay under the reading (取り扱い).
 */
export function rubyParts(surface: string, reading: string | undefined): RubyPart[] {
  if (!reading || !HAN.test(surface)) return [{ text: surface }];
  const kana = toHiragana(reading);
  let start = 0;
  let end = surface.length;
  let kanaStart = 0;
  let kanaEnd = kana.length;
  while (end > start && kanaEnd > kanaStart && !HAN.test(surface[end - 1]!) && toHiragana(surface[end - 1]!) === kana[kanaEnd - 1]) {
    end--;
    kanaEnd--;
  }
  while (start < end && kanaStart < kanaEnd && !HAN.test(surface[start]!) && toHiragana(surface[start]!) === kana[kanaStart]) {
    start++;
    kanaStart++;
  }
  const ruby = kana.slice(kanaStart, kanaEnd);
  if (start === end || !ruby) return [{ text: surface }];
  return [
    { text: surface.slice(0, start) },
    { text: surface.slice(start, end), ruby },
    { text: surface.slice(end) },
  ].filter((part) => part.text);
}

/** Where readings go in `text`. Empty if the tokens don't join back into `text` (then they can't be aligned). */
export function rubySpans(text: string, tokens: readonly ReadingToken[]): RubySpan[] {
  if (tokens.map((token) => token.surface).join('') !== text) return [];
  const spans: RubySpan[] = [];
  let position = 0;
  for (const token of tokens) {
    let offset = position;
    for (const part of rubyParts(token.surface, token.reading)) {
      if (part.ruby) spans.push({ start: offset, end: offset + part.text.length, ruby: part.ruby });
      offset += part.text.length;
    }
    position += token.surface.length;
  }
  return spans;
}

/** The parts of `text.slice(start, end)`, with readings from `spans` that lie fully inside it. */
export function rubyIn(text: string, spans: readonly RubySpan[], start: number, end: number): RubyPart[] {
  const parts: RubyPart[] = [];
  let position = start;
  for (const span of spans) {
    if (span.start < position || span.end > end) continue;
    if (span.start > position) parts.push({ text: text.slice(position, span.start) });
    parts.push({ text: text.slice(span.start, span.end), ruby: span.ruby });
    position = span.end;
  }
  if (position < end) parts.push({ text: text.slice(position, end) });
  return parts;
}
