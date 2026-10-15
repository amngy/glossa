import { toRomaji } from 'wanakana';
import type { ReadingToken, RubySpan } from './ruby';

const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const MACRON: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

/** Hepburn romaji; the long-vowel mark becomes a macron (トーキョー: tōkyō), where wanakana doubles the vowel. */
function romaji(kana: string): string {
  return kana
    .split('ー')
    .map((part) => toRomaji(part))
    .reduce((out, part) => out.replace(/[aiueo]$/, (vowel) => MACRON[vowel]!) + part);
}

/**
 * Romaji (Hepburn) over each Japanese word of `text`. It uses the word's pronunciation when the tokenizer
 * gives one, so the particle は reads "wa". Empty if the tokens don't join back into `text`.
 */
export function romajiSpans(text: string, tokens: readonly ReadingToken[]): RubySpan[] {
  if (tokens.map((token) => token.surface).join('') !== text) return [];
  const spans: RubySpan[] = [];
  let position = 0;
  for (const { surface, reading, pronunciation } of tokens) {
    const kana = pronunciation ?? reading ?? (KANA_ONLY.test(surface) ? surface : undefined);
    if (kana && JAPANESE.test(surface)) spans.push({ start: position, end: position + surface.length, ruby: romaji(kana) });
    position += surface.length;
  }
  return spans;
}
