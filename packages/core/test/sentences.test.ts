import { describe, expect, it } from 'vitest';
import { endsSentence, joinSentences, joinText } from '../src';

describe('joinSentences', () => {
  it('joins fragments split by short pauses, up to the sentence end', () => {
    const cues = [
      { start: 0, end: 1.5, text: 'So when I got' },
      { start: 2, end: 3, text: 'home, the door was open.' },
      { start: 3.4, end: 4.5, text: 'Weird, right?' },
      { start: 4.8, end: 6, text: 'And then' },
      { start: 8, end: 9, text: 'nothing.' },
    ];
    expect(joinSentences(cues).map((cue) => cue.text)).toEqual([
      'So when I got home, the door was open.',
      'Weird, right?',
      'And then',
      'nothing.',
    ]);
    expect(joinSentences(cues)[0]).toMatchObject({ start: 0, end: 3 });
  });

  it('joins unpunctuated Japanese without spaces, but not forever', () => {
    const cues = Array.from({ length: 8 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.6, text: 'このケーキ' }));
    const joined = joinSentences(cues);
    expect(joined[0]!.text).toBe('このケーキこのケーキこのケーキこのケーキこのケーキ');
    expect(joined.every((cue) => cue.end - cue.start <= 10)).toBe(true);
  });

  it('knows sentence ends and seams', () => {
    expect(endsSentence('誰が作ったんですか？')).toBe(true);
    expect(endsSentence('He said "stop."')).toBe(true);
    expect(endsSentence('and then')).toBe(false);
    expect(joinText('I went', 'home')).toBe('I went home');
    expect(joinText('明日は', '日曜日です')).toBe('明日は日曜日です');
  });
});
