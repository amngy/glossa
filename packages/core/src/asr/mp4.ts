/**
 * Reads AAC frames out of the fragmented MP4 a video player appends to Media Source Extensions, for
 * look-ahead transcription (#91): YouTube sends some streams' audio as MP4/AAC instead of WebM/Opus.
 * Like `WebmDemuxer`, it parses a stream: a box cut off by the end of a push waits for the next push.
 */

import type { WebmFrame, WebmTrack } from './webm';

/** `codec` is a WebCodecs codec string (e.g. `mp4a.40.2`); `codecPrivate` the AudioSpecificConfig. */
export type Mp4Track = WebmTrack;
export type Mp4Frame = WebmFrame;

/** Boxes whose children we need; they are entered, not skipped. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'traf']);
/** Unparsed bytes beyond this are dropped: the stream isn't MP4, or it broke. */
const MAX_PENDING = 1 << 22;

interface Box {
  type: string;
  body: number;
  end: number;
}

/** The box at `at`, or null if its header isn't all there. `end` may lie beyond the data. */
function readBox(data: Uint8Array, at: number): Box | null {
  if (at + 8 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset);
  let size = view.getUint32(at);
  const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
  let body = at + 8;
  if (size === 1) {
    if (at + 16 > data.length) return null;
    size = Number(view.getBigUint64(at + 8));
    body = at + 16;
  }
  return size < body - at ? null : { type, body, end: at + size };
}

/** Whether `bytes` starts a new MP4 stream (an init segment). */
export function isMp4Init(bytes: Uint8Array): boolean {
  const type = readBox(bytes, 0)?.type;
  return type === 'ftyp' || type === 'moov';
}

interface Sample {
  offset: number;
  size: number;
  duration: number;
}

/** A minimal streaming fragmented-MP4 demuxer for one audio track: its settings and its frames with times. */
export class Mp4Demuxer {
  track: Mp4Track | null = null;
  private pending = new Uint8Array(0);
  private timescale = 0;
  private defaultDuration = 0;
  private defaultSize = 0;
  private seeking = false;

  /** Skips bytes until the next fragment starts, for a stream joined in the middle. */
  resync(): void {
    this.seeking = true;
    this.pending = new Uint8Array(0);
  }

  push(bytes: Uint8Array): Mp4Frame[] {
    const data = new Uint8Array(this.pending.length + bytes.length);
    data.set(this.pending);
    data.set(bytes, this.pending.length);
    const frames: Mp4Frame[] = [];
    let at = 0;
    if (this.seeking) {
      at = findMoof(data);
      if (at < 0) {
        // Keep a possible start of the next moof header.
        this.pending = data.slice(Math.max(0, data.length - 7));
        return frames;
      }
      this.seeking = false;
    }
    for (;;) {
      const box = readBox(data, at);
      if (!box || box.end > data.length) break;
      if (box.type === 'moov') this.walk(data, box);
      else if (box.type === 'moof') {
        // Its samples sit in the mdat that follows, so wait until that is here too.
        const mdat = readBox(data, box.end);
        if (!mdat || mdat.end > data.length) break;
        this.fragment(data, at, box, mdat, frames);
        at = mdat.end;
        continue;
      }
      at = box.end;
    }
    this.pending = data.length - at > MAX_PENDING ? new Uint8Array(0) : data.slice(at);
    return frames;
  }

  /** The init segment's track settings. */
  private walk(data: Uint8Array, parent: Box): void {
    const view = new DataView(data.buffer, data.byteOffset);
    for (let at = parent.body; ; ) {
      const box = readBox(data, at);
      if (!box || box.end > parent.end) return;
      if (CONTAINERS.has(box.type)) this.walk(data, box);
      else if (box.type === 'mdhd') this.timescale = view.getUint32(box.body + (data[box.body] === 1 ? 20 : 12));
      else if (box.type === 'trex') {
        this.defaultDuration = view.getUint32(box.body + 12);
        this.defaultSize = view.getUint32(box.body + 16);
      } else if (box.type === 'stsd') {
        const entry = readBox(data, box.body + 8);
        if (entry?.type === 'mp4a') {
          this.track = { codec: 'mp4a.40.2', channels: view.getUint16(entry.body + 16), sampleRate: view.getUint32(entry.body + 24) >>> 16 };
          const esds = readBox(data, entry.body + 28);
          if (esds?.type === 'esds') this.esds(data.subarray(esds.body + 4, esds.end));
        } else if (entry) this.track = { codec: entry.type };
      }
      at = box.end;
    }
  }

  /** The AudioSpecificConfig, from the DecoderSpecificInfo inside the ES descriptor. */
  private esds(data: Uint8Array): void {
    for (let at = 0; at < data.length; ) {
      const tag = data[at++]!;
      let size = 0;
      for (let i = 0; i < 4; i++) {
        const byte = data[at++] ?? 0;
        size = (size << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) break;
      }
      if (tag === 0x03) {
        // ES_ID, then flags that add optional fields before the nested descriptors.
        const flags = data[at + 2] ?? 0;
        at += 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + (data[at + 3] ?? 0) : 0) + (flags & 0x20 ? 2 : 0);
      } else if (tag === 0x04) at += 13;
      else if (tag === 0x05) {
        const config = data.slice(at, at + size);
        if (this.track && config.length) {
          this.track.codecPrivate = config;
          // The audio object type is the config's first five bits (2 = AAC-LC, 5 = HE-AAC).
          this.track.codec = `mp4a.40.${config[0]! >> 3}`;
        }
        return;
      } else at += size;
    }
  }

  private fragment(data: Uint8Array, moofStart: number, moof: Box, mdat: Box, frames: Mp4Frame[]): void {
    const view = new DataView(data.buffer, data.byteOffset);
    let base = 0;
    let duration = this.defaultDuration;
    let size = this.defaultSize;
    let samples: Sample[] = [];
    const visit = (parent: Box) => {
      for (let at = parent.body; ; ) {
        const box = readBox(data, at);
        if (!box || box.end > parent.end) return;
        // Full boxes start with a version byte and 24 bits of flags.
        const flags = box.type === 'traf' ? 0 : view.getUint32(box.body) & 0xffffff;
        if (box.type === 'traf') visit(box);
        else if (box.type === 'tfhd') {
          let field = box.body + 8 + (flags & 0x01 ? 8 : 0) + (flags & 0x02 ? 4 : 0);
          if (flags & 0x08) {
            duration = view.getUint32(field);
            field += 4;
          }
          if (flags & 0x10) size = view.getUint32(field);
        } else if (box.type === 'tfdt') {
          base = data[box.body] === 1 ? Number(view.getBigUint64(box.body + 4)) : view.getUint32(box.body + 4);
        } else if (box.type === 'trun') {
          const count = view.getUint32(box.body + 4);
          let field = box.body + 8;
          // Without a data offset, samples start at the mdat's data.
          let offset = mdat.body;
          if (flags & 0x01) {
            offset = moofStart + view.getInt32(field);
            field += 4;
          }
          if (flags & 0x04) field += 4;
          samples = [];
          for (let i = 0; i < count; i++) {
            const sample = { offset, size, duration };
            if (flags & 0x100) {
              sample.duration = view.getUint32(field);
              field += 4;
            }
            if (flags & 0x200) {
              sample.size = view.getUint32(field);
              field += 4;
            }
            field += (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
            samples.push(sample);
            offset += sample.size;
          }
        }
        at = box.end;
      }
    };
    visit(moof);
    if (!this.timescale || this.track?.codec.startsWith('mp4a') !== true) return;
    let time = base;
    for (const sample of samples) {
      if (sample.offset >= mdat.body && sample.offset + sample.size <= mdat.end) {
        frames.push({ track: 1, time: time / this.timescale, data: data.slice(sample.offset, sample.offset + sample.size) });
      }
      time += sample.duration;
    }
  }
}

function findMoof(data: Uint8Array): number {
  for (let i = 0; i + 8 <= data.length; i++) {
    if (data[i + 4] === 0x6d && data[i + 5] === 0x6f && data[i + 6] === 0x6f && data[i + 7] === 0x66) return i; // "moof"
  }
  return -1;
}
