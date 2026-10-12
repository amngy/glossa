import { describe, expect, it } from 'vitest';
import { toAnkiTsv, toCsv, type SavedWord } from '../src';

const word: SavedWord = {
  id: '1',
  word: 'está',
  lang: 'es',
  translation: 'is',
  sentence: '¿Dónde "está" la biblioteca,\nporfa?',
  source: { url: 'https://www.youtube.com/watch?v=abc', title: 'Video', time: 12.6 },
  createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
};

describe('toCsv', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    const [header, row] = toCsv([word]).trimEnd().split('\r\n');
    expect(header).toBe(
      'word,language,translation,definition,sentence,sentence_translation,source_url,source_title,time_seconds,saved_at',
    );
    expect(row).toBe(
      'está,es,is,,"¿Dónde ""está"" la biblioteca,\nporfa?",,https://www.youtube.com/watch?v=abc,Video,13,2026-01-02T03:04:05.000Z',
    );
  });
});

describe('toAnkiTsv', () => {
  it('writes Anki headers and one escaped, tab-separated note per word', () => {
    const lines = toAnkiTsv([word]).trimEnd().split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '#separator:tab',
      '#html:true',
      '#columns:Front\tBack\tTags',
      '#tags column:3',
    ]);
    const [front, back, tags] = lines[4]!.split('\t');
    expect(front).toBe('está<br><br><i>¿Dónde &quot;<b>está</b>&quot; la biblioteca,<br>porfa?</i>');
    expect(back).toBe('<b>is</b>');
    expect(tags).toBe('glossa glossa::es');
  });
});
