import { describe, expect, it } from 'vitest';
import { baseLanguage, languageFromFileName, languageName, normalizeWord, tokenize } from '../src';

const words = (text: string, lang: string) =>
  tokenize(text, lang)
    .filter((t) => t.isWord)
    .map((t) => t.text);

describe('tokenize', () => {
  it('splits space-separated languages and marks punctuation as non-words', () => {
    const tokens = tokenize('¿Dónde está la biblioteca?', 'es');
    expect(tokens.map((t) => t.text).join('')).toBe('¿Dónde está la biblioteca?');
    expect(words('¿Dónde está la biblioteca?', 'es')).toEqual(['Dónde', 'está', 'la', 'biblioteca']);
  });

  it('keeps contractions together and skips numbers', () => {
    expect(words("I don't have 3 cats", 'en')).toEqual(['I', "don't", 'have', 'cats']);
  });

  it('segments Japanese, which has no spaces', () => {
    const result = words('私は学生です', 'ja');
    expect(result.length).toBeGreaterThan(1);
    expect(result.join('')).toBe('私は学生です');
  });

  it('keeps Japanese verbs whole by clicking phrases', () => {
    expect(words('気をつけて帰ってね', 'ja')).toEqual(['気を', 'つけて', '帰ってね']);
    expect(words('食べられなかった', 'ja-JP')).toEqual(['食べられなかった']);
    expect(tokenize('どうぞ、上がってください', 'ja')).toEqual([
      { text: 'どうぞ', isWord: true },
      { text: '、', isWord: false },
      { text: '上がってください', isWord: true },
    ]);
  });

  it('falls back gracefully on an invalid language tag', () => {
    expect(words('hello world', 'not a tag!')).toEqual(['hello', 'world']);
  });
});

describe('language helpers', () => {
  it('normalizes words for lookup', () => {
    expect(normalizeWord('«Está»', 'es')).toBe('está');
    expect(normalizeWord('İstanbul', 'tr')).toBe('istanbul');
  });

  it('extracts base languages and names', () => {
    expect(baseLanguage('pt-BR')).toBe('pt');
    expect(baseLanguage('zh_Hant')).toBe('zh');
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('hu', 'de')).toBe('Ungarisch');
  });
});

describe('languageFromFileName', () => {
  it('reads language codes and names from subtitle file names', () => {
    expect(languageFromFileName('Movie.2020.es.srt')).toBe('es');
    expect(languageFromFileName('show_S01E01.pt-br.vtt')).toBe('pt-BR');
    expect(languageFromFileName('show.S01E01.en.forced.srt')).toBe('en');
    expect(languageFromFileName('Film [German].srt')).toBe('de');
    expect(languageFromFileName('C:\subs\La casa.fr.srt')).toBe('fr');
  });

  it('returns null without a clear hint', () => {
    expect(languageFromFileName('The.End.of.Evangelion.srt')).toBeNull();
    expect(languageFromFileName('subtitles.vtt')).toBeNull();
  });
});
