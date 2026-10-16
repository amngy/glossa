import { describe, expect, it } from 'vitest';
import { isMp4Init, Mp4Demuxer, type Mp4Frame } from '../src';

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const box = (type: string, ...body: number[][]) => {
  const bytes = body.flat();
  return [...u32(8 + bytes.length), ...[...type].map((c) => c.charCodeAt(0)), ...bytes];
};
const full = (type: string, flags: number, ...body: number[][]) => box(type, u32(flags), ...body);

// AudioSpecificConfig for AAC-LC (object type 2), 44.1 kHz, stereo.
const asc = [0x12, 0x10];
const esds = full('esds', 0, [0x03, 0x80, 0x80, 0x80, 25, 0, 1, 0], [0x04, 17, 0x40, 0x15, ...Array(11).fill(0)], [0x05, asc.length, ...asc]);
const mp4a = box('mp4a', Array(6).fill(0), u16(1), Array(8).fill(0), u16(2), u16(16), Array(4).fill(0), u32(44100 << 16), esds);
const init = [
  ...box('ftyp', [...'dash'].map((c) => c.charCodeAt(0)), u32(0)),
  ...box(
    'moov',
    box('trak', box('mdia', full('mdhd', 0, u32(0), u32(0), u32(44100), u32(0), u32(0)), box('minf', box('stbl', full('stsd', 0, u32(1), mp4a))))),
    box('mvex', full('trex', 0, u32(1), u32(1), u32(1024), u32(0), u32(0))),
  ),
];
// A fragment: tfdt base time, trun with a data offset and per-sample sizes; durations come from trex.
const fragment = (base: number, samples: number[][]) => {
  const trun = (offset: number) => full('trun', 0x201, u32(samples.length), u32(offset), ...samples.map((s) => u32(s.length)));
  const moof = (offset: number) => box('moof', full('mfhd', 0, u32(1)), box('traf', full('tfhd', 0x020000, u32(1)), full('tfdt', 0, u32(base)), trun(offset)));
  return [...moof(moof(0).length + 8), ...box('mdat', samples.flat())];
};
const stream = Uint8Array.from([...init, ...fragment(44100, [[1, 1], [2]]), ...box('emsg', [0]), ...fragment(46148, [[3, 3, 3]])]);
const summary = (frames: Mp4Frame[]) => frames.map((f) => [Math.round(f.time * 1e4) / 1e4, [...f.data]]);
const expected = [
  [1, [1, 1]],
  [1.0232, [2]],
  [1.0464, [3, 3, 3]],
];

describe('Mp4Demuxer', () => {
  it('reads the AAC settings and the frames with their times', () => {
    const demuxer = new Mp4Demuxer();
    expect(summary(demuxer.push(stream))).toEqual(expected);
    expect(demuxer.track).toEqual({ codec: 'mp4a.40.2', channels: 2, sampleRate: 44100, codecPrivate: Uint8Array.from(asc) });
    expect(isMp4Init(stream)).toBe(true);
  });

  it('gives the same frames however the player cuts its appends', () => {
    for (let cut = 1; cut < stream.length; cut += 7) {
      const demuxer = new Mp4Demuxer();
      const frames = [...demuxer.push(stream.subarray(0, cut)), ...demuxer.push(stream.subarray(cut))];
      expect(summary(frames)).toEqual(expected);
    }
  });

  it('picks up at the next fragment when joined in the middle', () => {
    const demuxer = new Mp4Demuxer();
    demuxer.push(Uint8Array.from(init));
    demuxer.resync();
    const second = stream.length - fragment(46148, [[3, 3, 3]]).length;
    expect(summary(demuxer.push(stream.subarray(second - 5)))).toEqual([expected[2]]);
  });
});
