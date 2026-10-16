import { describe, expect, it } from 'vitest';
import { learnerDelayTarget, LiveLine } from '../src';

describe('learnerDelayTarget', () => {
  it('seeks back from the live edge, but never before the start of the window', () => {
    expect(learnerDelayTarget(1000, 0, 1000, 20)).toBe(980);
    expect(learnerDelayTarget(1000, 995, 1000, 20)).toBe(995);
  });
  it('leaves a viewer who is already far enough behind, and does nothing when off or unseekable', () => {
    expect(learnerDelayTarget(900, 0, 1000, 20)).toBeNull();
    expect(learnerDelayTarget(1000, 0, 1000, 0)).toBeNull();
    expect(learnerDelayTarget(5, 0, Infinity, 20)).toBeNull();
  });
});

describe('LiveLine', () => {
  it('settles words once two updates agree and holds back the last ones for translation', () => {
    const line = new LiveLine('en');
    expect(line.update('I went to')).toMatchObject({ settled: '', translatable: '' });
    const second = line.update('I went to the market');
    expect(second.settled).toBe('I went to');
    expect(second.translatable).toBe('I');
    const third = line.update('I went to the market today');
    expect(third.settled).toBe('I went to the market');
    expect(third.translatable).toBe('I went to');
  });

  it('does not settle words the recogniser changed', () => {
    const line = new LiveLine('en');
    line.update('this weekend we');
    expect(line.update('this week end we go').settled).toBe('this ');
  });

  it('keeps settled text while later hypotheses still start with it, and drops it once contradicted', () => {
    const line = new LiveLine('en', 1);
    line.update('one two three');
    expect(line.update('one two three four').settled).toBe('one two three');
    expect(line.update('one two three five').settled).toBe('one two three ');
    expect(line.update('one too three five').settled).toBe('one ');
  });

  it('settles everything when the line is final', () => {
    const line = new LiveLine('en');
    line.update('good morning');
    expect(line.update('good morning everyone', true)).toEqual({
      text: 'good morning everyone',
      settled: 'good morning everyone',
      translatable: 'good morning everyone',
    });
  });

  it('works for text without spaces', () => {
    const line = new LiveLine('ja', 1);
    line.update('今週末は');
    const next = line.update('今週末は買い物に行きます');
    expect(next.settled).toBe('今週末は');
    expect('今週末は買い物に行きます'.startsWith(next.translatable)).toBe(true);
  });
});
