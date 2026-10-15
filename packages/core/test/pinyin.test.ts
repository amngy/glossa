import { describe, expect, it } from 'vitest';
import { chineseReadings, rubySpans } from '../src';

describe('chineseReadings', () => {
  it('reads each character by its word, and lines up with the text', () => {
    const text = '我们去银行。OK吗？';
    const tokens = chineseReadings(text);
    expect(tokens.map((token) => token.surface).join('')).toBe(text);
    expect(rubySpans(text, tokens).map((span) => `${text.slice(span.start, span.end)}:${span.ruby}`)).toEqual([
      '我:wǒ', '们:men', '去:qù', '银:yín', '行:háng', '吗:ma',
    ]);
    expect(chineseReadings('行走')[0]!.reading).toBe('xíng');
  });
});
