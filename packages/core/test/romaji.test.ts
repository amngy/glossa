import { describe, expect, it } from 'vitest';
import { romajiSpans } from '../src';

describe('romajiSpans', () => {
  it('puts romaji over each Japanese word, using how it is said', () => {
    const text = '私は東京へ行く。OK';
    const tokens = [
      { surface: '私', reading: 'ワタシ', pronunciation: 'ワタシ' },
      { surface: 'は', reading: 'ハ', pronunciation: 'ワ' },
      { surface: '東京', reading: 'トウキョウ', pronunciation: 'トーキョー' },
      { surface: 'へ', reading: 'ヘ', pronunciation: 'エ' },
      { surface: '行く', reading: 'イク', pronunciation: 'イク' },
      { surface: '。' },
      { surface: 'OK' },
    ];
    expect(romajiSpans(text, tokens).map((span) => `${text.slice(span.start, span.end)}:${span.ruby}`)).toEqual([
      '私:watashi', 'は:wa', '東京:tōkyō', 'へ:e', '行く:iku',
    ]);
  });

  it('reads kana words the tokenizer has no reading for, and gives up on tokens that do not line up', () => {
    expect(romajiSpans('ねえ', [{ surface: 'ねえ' }])).toEqual([{ start: 0, end: 2, ruby: 'nee' }]);
    expect(romajiSpans('猫', [{ surface: '犬', reading: 'イヌ' }])).toEqual([]);
  });
});
