import { describe, expect, it } from 'vitest';
import { isWebmInit, mixToMono, WebmDemuxer, type WebmFrame } from '../src';

// EBML element: ID bytes, a 1-byte size, then the body. `unknownSize` is how live streams write Segments and Clusters.
const el = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body];
const unknownSize = (id: number[], body: number[]) => [...id, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...body];
const simpleBlock = (relative: number, payload: number[], flags = 0x80) =>
  el([0xa3], [0x81, (relative >> 8) & 0xff, relative & 0xff, flags, ...payload]);
const blockGroup = (relative: number, payload: number[]) =>
  el([0xa0], [...el([0xa1], [0x81, (relative >> 8) & 0xff, relative & 0xff, 0x00, ...payload]), ...el([0x9b], [20])]);
const cluster = (timecode: number, ...blocks: number[][]) =>
  unknownSize([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], [(timecode >> 8) & 0xff, timecode & 0xff]), ...blocks.flat()]);

const init = [
  ...el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), // EBML header, DocType "webm"
  ...unknownSize([0x18, 0x53, 0x80, 0x67], [
    ...el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])), // Info: TimecodeScale 1 ms
    ...el([0x16, 0x54, 0xae, 0x6b], el([0xae], [ // Tracks > TrackEntry
      ...el([0x86], [...'A_OPUS'].map((c) => c.charCodeAt(0))),
      ...el([0x63, 0xa2], [1, 2, 3]),
      ...el([0xe1], [...el([0x9f], [2]), ...el([0xb5], [0x47, 0x3b, 0x80, 0x00])]), // Audio: 2 channels, 48000 Hz
    ])),
  ]),
];
const media = [
  ...cluster(10000, simpleBlock(0, [9, 9]), simpleBlock(20, [8]), blockGroup(40, [7, 7, 7])),
  ...cluster(10060, simpleBlock(0, [6]), simpleBlock(-1, [5], 0x86 /* laced */)),
];
const stream = Uint8Array.from([...init, ...media]);
const expected = [
  [10, [9, 9]],
  [10.02, [8]],
  [10.04, [7, 7, 7]],
  [10.06, [6]],
];
const summary = (frames: WebmFrame[]) => frames.map((f) => [f.time, [...f.data]]);

function demux(cuts: number[], bytes = stream) {
  const demuxer = new WebmDemuxer();
  const frames: WebmFrame[] = [];
  let at = 0;
  for (const cut of [...cuts, bytes.length]) {
    frames.push(...demuxer.push(bytes.subarray(at, cut)));
    at = cut;
  }
  return { demuxer, frames };
}

describe('WebmDemuxer', () => {
  it('reads the track and frame times in one piece', () => {
    const { demuxer, frames } = demux([]);
    expect(demuxer.track).toEqual({ codec: 'A_OPUS', codecPrivate: Uint8Array.from([1, 2, 3]), channels: 2, sampleRate: 48000 });
    expect(summary(frames)).toEqual(expected);
    expect(demuxer.laced).toBe(1);
  });

  it('gives the same frames however the appends are cut', () => {
    for (let size = 1; size <= stream.length; size++) {
      const cuts = Array.from({ length: Math.ceil(stream.length / size) - 1 }, (_, i) => (i + 1) * size);
      expect(summary(demux(cuts).frames), `appends of ${size} bytes`).toEqual(expected);
    }
    for (let cut = 1; cut < stream.length; cut++) expect(summary(demux([cut]).frames), `cut at ${cut}`).toEqual(expected);
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const cuts = [...new Set(Array.from({ length: 6 }, () => Math.floor(random() * stream.length)))].sort((a, b) => a - b);
      expect(summary(demux(cuts).frames), `cuts ${cuts}`).toEqual(expected);
    }
  });

  it('joins a stream in the middle at the next cluster', () => {
    const demuxer = new WebmDemuxer();
    demuxer.push(Uint8Array.from(init));
    demuxer.resync();
    const secondCluster = init.length + cluster(10000, simpleBlock(0, [9, 9]), simpleBlock(20, [8]), blockGroup(40, [7, 7, 7])).length;
    // From the middle of the first cluster, cut inside the second cluster's ID.
    const rest = stream.subarray(init.length + 15);
    const cut = secondCluster - init.length - 15 + 2;
    const frames = [...demuxer.push(rest.subarray(0, cut)), ...demuxer.push(rest.subarray(cut))];
    expect(summary(frames)).toEqual([[10.06, [6]]]);
    expect(demuxer.track?.codec).toBe('A_OPUS');
  });

  it('recognises an init segment', () => {
    expect(isWebmInit(stream)).toBe(true);
    expect(isWebmInit(Uint8Array.from(media))).toBe(false);
    expect(isWebmInit(new Uint8Array(0))).toBe(false);
  });
});

describe('mixToMono', () => {
  it('averages channels and resamples 48 kHz to 16 kHz', () => {
    const left = Float32Array.from([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]);
    const right = Float32Array.from([0.1, 0.1, 0.1, 0, 0, 0]);
    expect([...mixToMono([left, right], 48000)].map((x) => +x.toFixed(4))).toEqual([0.2, 0.3]);
    expect(mixToMono([new Float32Array(960)], 48000)).toHaveLength(320);
  });
});
