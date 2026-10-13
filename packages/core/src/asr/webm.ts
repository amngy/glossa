/**
 * Reads audio frames out of the WebM bytes a video player appends to Media Source Extensions, for
 * look-ahead transcription (#44). The player appends a few KB at a time, cut anywhere, so this parses
 * a stream: bytes that don't finish an element wait for the next push.
 */

export interface WebmTrack {
  /** Matroska codec ID, e.g. `A_OPUS`. */
  codec: string;
  /** CodecPrivate: for Opus, the `OpusHead` that WebCodecs' `AudioDecoder` takes as `description`. */
  codecPrivate?: Uint8Array;
  sampleRate?: number;
  channels?: number;
}

export interface WebmFrame {
  track: number;
  /** Seconds on the stream's own timeline, before the SourceBuffer's `timestampOffset`. */
  time: number;
  data: Uint8Array;
}

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const TRACK_ENTRY = 0xae;
/** Elements whose children we need; they are entered, not skipped. */
const MASTERS = new Set([SEGMENT, CLUSTER, 0x1654ae6b /* Tracks */, TRACK_ENTRY, 0xe1 /* Audio */, 0xa0 /* BlockGroup */, 0x1549a966 /* Info */]);
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];
/** Unparsed bytes beyond this are dropped: the stream isn't WebM, or it broke. */
const MAX_PENDING = 1 << 22;

/** Whether `bytes` starts a new WebM stream (an init segment). */
export function isWebmInit(bytes: Uint8Array): boolean {
  return readVint(bytes, 0, true)?.value === EBML;
}

/**
 * A minimal streaming WebM demuxer: the audio track's settings and its frames with times. Laced blocks
 * are skipped and counted; Opus in WebM isn't laced.
 */
export class WebmDemuxer {
  track: WebmTrack | null = null;
  laced = 0;
  private pending = new Uint8Array(0);
  private timecodeScale = 1e6;
  private clusterTime = 0;
  private seeking = false;

  /** Skips bytes until the next Cluster starts, for a stream joined in the middle (e.g. after its init segment was replayed). */
  resync(): void {
    this.seeking = true;
    this.pending = new Uint8Array(0);
  }

  push(bytes: Uint8Array): WebmFrame[] {
    const data = new Uint8Array(this.pending.length + bytes.length);
    data.set(this.pending);
    data.set(bytes, this.pending.length);
    const frames: WebmFrame[] = [];
    let at = 0;
    if (this.seeking) {
      at = findCluster(data);
      if (at < 0) {
        // Keep a possible start of the Cluster ID for the next push.
        this.pending = data.slice(Math.max(0, data.length - CLUSTER_ID.length + 1));
        return frames;
      }
      this.seeking = false;
    }
    for (;;) {
      const id = readVint(data, at, true);
      const size = id && readVint(data, at + id.length, false);
      if (!id || !size) break;
      const body = at + id.length + size.length;
      // Masters (also those of unknown size, like the Segment and Clusters of a live stream) are entered.
      if (MASTERS.has(id.value)) {
        if (id.value === SEGMENT || id.value === CLUSTER) this.clusterTime = 0;
        if (id.value === TRACK_ENTRY) this.track = { codec: '' };
        at = body;
        continue;
      }
      if (size.value < 0 || body + size.value > data.length) break;
      this.leaf(id.value, data.subarray(body, body + size.value), frames);
      at = body + size.value;
    }
    this.pending = data.length - at > MAX_PENDING ? new Uint8Array(0) : data.slice(at);
    return frames;
  }

  private leaf(id: number, value: Uint8Array, frames: WebmFrame[]): void {
    const track = this.track;
    switch (id) {
      case 0x2ad7b1: // TimecodeScale
        this.timecodeScale = readUint(value);
        break;
      case 0xe7: // Cluster Timecode
        this.clusterTime = readUint(value);
        break;
      case 0x86: // CodecID
        if (track) track.codec = String.fromCharCode(...value);
        break;
      case 0x63a2: // CodecPrivate
        if (track) track.codecPrivate = value.slice();
        break;
      case 0x9f: // Channels
        if (track) track.channels = readUint(value);
        break;
      case 0xb5: // SamplingFrequency
        if (track) track.sampleRate = readFloat(value);
        break;
      case 0xa3: // SimpleBlock
      case 0xa1: {
        // Block, inside a BlockGroup
        const number = readVint(value, 0, false);
        if (!number || value.length < number.length + 3) return;
        if (value[number.length + 2]! & 0x06) {
          this.laced++;
          return;
        }
        const relative = new DataView(value.buffer, value.byteOffset + number.length, 2).getInt16(0);
        frames.push({
          track: number.value,
          time: ((this.clusterTime + relative) * this.timecodeScale) / 1e9,
          data: value.slice(number.length + 3),
        });
      }
    }
  }
}

function findCluster(data: Uint8Array): number {
  for (let i = 0; i + CLUSTER_ID.length <= data.length; i++) {
    if (CLUSTER_ID.every((byte, k) => data[i + k] === byte)) return i;
  }
  return -1;
}

/** An EBML variable-length integer. IDs keep their marker bit; sizes drop it, and all ones means unknown (-1). */
function readVint(data: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } | null {
  const first = data[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (at + length > data.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + data[at + i]!;
    allOnes &&= data[at + i] === 0xff;
  }
  return { value: !keepMarker && allOnes ? -1 : value, length };
}

function readUint(value: Uint8Array): number {
  return value.reduce((n, byte) => n * 256 + byte, 0);
}

function readFloat(value: Uint8Array): number {
  const view = new DataView(value.buffer, value.byteOffset, value.length);
  return value.length === 4 ? view.getFloat32(0) : view.getFloat64(0);
}
