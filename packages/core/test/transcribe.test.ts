import { describe, expect, it } from 'vitest';
import { addTranscribedCues, Endpointer, HeardSpans, MediaClock, placeSpokenLines, segmentsToCues } from '../src';

const RATE = 16000;
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const tone = (seconds: number, amplitude = 0.2) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin(i * 0.3));
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

describe('Endpointer', () => {
  it('cuts speech at pauses and drops short blips', () => {
    const endpointer = new Endpointer();
    const found = [
      ...endpointer.push(join(silence(1), tone(1.5), silence(1), tone(0.1), silence(1))),
      ...endpointer.flush(),
    ];
    expect(found).toHaveLength(1);
    const seconds = found[0]!.samples.length / RATE;
    expect(seconds).toBeGreaterThan(1.5);
    expect(seconds).toBeLessThan(2.5);
    // Starts a little before the speech (1 s in), so the first sound isn't clipped.
    expect(found[0]!.start / RATE).toBeGreaterThan(0.7);
    expect(found[0]!.start / RATE).toBeLessThanOrEqual(1);
  });

  it('cuts speech that never pauses at the maximum length', () => {
    const endpointer = new Endpointer({ maxLength: 10 });
    const found = [...endpointer.push(tone(25)), ...endpointer.flush()];
    expect(found.map((u) => Math.round(u.samples.length / RATE))).toEqual([10, 10, 5]);
    expect(found[1]!.start).toBe(found[0]!.samples.length);
  });

  it('gives the same result however the audio is chunked', () => {
    const audio = join(silence(0.7), tone(2), silence(0.8), tone(1));
    const whole = new Endpointer();
    const expected = [...whole.push(audio), ...whole.flush()];
    const pieces = new Endpointer();
    const found: ReturnType<Endpointer['push']> = [];
    for (let i = 0; i < audio.length; i += 1000) found.push(...pieces.push(audio.subarray(i, i + 1000)));
    found.push(...pieces.flush());
    expect(found.map((u) => [u.start, u.samples.length])).toEqual(expected.map((u) => [u.start, u.samples.length]));
  });
});

describe('MediaClock', () => {
  it('follows the video through a pause and a seek', () => {
    const clock = new MediaClock();
    expect(clock.mediaAt(1000)).toBeUndefined();
    clock.record(1000, 10);
    clock.record(1250, 10.25);
    // Paused for a while, then the viewer seeked back to 3 s.
    clock.record(9000, 3);
    expect(clock.mediaAt(1500)).toBeCloseTo(10.5);
    expect(clock.mediaAt(9500)).toBeCloseTo(3.5);
  });

  it('uses the playback rate', () => {
    const clock = new MediaClock();
    clock.record(0, 0, 2);
    expect(clock.mediaAt(1000)).toBeCloseTo(2);
  });
});

describe('placeSpokenLines / addTranscribedCues', () => {
  it('places lines on the timeline and skips what it cannot place', () => {
    const clock = new MediaClock();
    clock.record(1000, 5);
    const cues = placeSpokenLines(
      [
        { startWall: 1500, endWall: 3500, text: ' こんにちは ' },
        { startWall: 4000, endWall: 4000, text: 'empty span' },
        { startWall: 5000, endWall: 6000, text: '  ' },
      ],
      clock,
    );
    expect(cues).toEqual([{ start: 5.5, end: 7.5, text: 'こんにちは' }]);
  });

  it('does not duplicate a part of the video that was watched again', () => {
    const first = [
      { start: 0, end: 4, text: 'a' },
      { start: 5, end: 8, text: 'b' },
    ];
    const again = [
      { start: 0.2, end: 3.9, text: 'a again' },
      { start: 9, end: 11, text: 'c' },
      { start: 4, end: 4.9, text: 'between' },
    ];
    expect(addTranscribedCues(first, again).map((cue) => cue.text)).toEqual(['a', 'between', 'b', 'c']);
  });
});

describe('segmentsToCues', () => {
  it('moves segments to media time and drops noise lines', () => {
    const segments = [
      { start: 0.4, end: 1.9, text: ' 今週末は ' },
      { start: 2, end: 2.5, text: '♪' },
      { start: 2.6, end: null, text: '晴れです' },
    ];
    expect(segmentsToCues(segments, 40.25)).toEqual([
      { start: 40.65, end: 42.15, text: '今週末は' },
      { start: 42.85, end: 44.85, text: '晴れです' },
    ]);
  });
});

describe('HeardSpans', () => {
  it('grows while playing, splits on a seek, and merges when they meet', () => {
    const heard = new HeardSpans();
    for (let t = 10; t <= 20; t += 0.25) heard.add(t);
    expect(heard.covers(15)).toBe(true);
    expect(heard.covers(19.5, 1)).toBe(false); // near the end: listen again
    expect(heard.covers(25)).toBe(false);
    heard.add(30); // seek ahead
    expect(heard.covers(25)).toBe(false);
    for (let t = 20; t <= 30; t += 0.5) heard.add(t); // plays on into the later span
    expect(heard.covers(25)).toBe(true);
    heard.add(5); // rewind before anything heard
    expect(heard.covers(5.5)).toBe(false);
    heard.clear();
    expect(heard.covers(15)).toBe(false);
  });
});
