import type { Cue } from '../subtitles/types';

/** Pieces of live speech recognition that don't need a browser: splitting audio, timing and merging lines. */

export interface Utterance {
  samples: Float32Array;
  /** Index of the first sample in the stream the endpointer was fed. */
  start: number;
}

export interface EndpointOptions {
  sampleRate?: number;
  /** Frames quieter than this (RMS, 0 to 1) count as silence. */
  threshold?: number;
  /** Seconds of silence that end an utterance. */
  silence?: number;
  /** Utterances with less speech than this (seconds) are noise and dropped. */
  minSpeech?: number;
  /** A longer utterance is cut here (seconds), so lines stay short and Whisper's 30 s window is never exceeded. */
  maxLength?: number;
}

const FRAME_SECONDS = 0.03;
/** Silence kept before the first loud frame, so a word's start isn't clipped. */
const PREROLL_FRAMES = 6;

function rms(frame: Float32Array): number {
  let sum = 0;
  for (const value of frame) sum += value * value;
  return Math.sqrt(sum / frame.length);
}

/**
 * Cuts a stream of mono audio into utterances at pauses, by loudness. Not a real voice detector:
 * music or noise that never goes quiet is only cut at `maxLength`.
 */
export class Endpointer {
  private readonly frameSize: number;
  private readonly threshold: number;
  private readonly silenceFrames: number;
  private readonly minSpeechFrames: number;
  private readonly maxFrames: number;

  private carry = new Float32Array(0);
  /** Samples fed so far, in whole frames. */
  private position = 0;
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private utteranceStart = 0;
  private quiet = 0;
  private loudFrames = 0;

  constructor({ sampleRate = 16000, threshold = 0.012, silence = 0.5, minSpeech = 0.3, maxLength = 15 }: EndpointOptions = {}) {
    this.frameSize = Math.round(sampleRate * FRAME_SECONDS);
    this.threshold = threshold;
    this.silenceFrames = Math.ceil(silence / FRAME_SECONDS);
    this.minSpeechFrames = Math.ceil(minSpeech / FRAME_SECONDS);
    this.maxFrames = Math.floor(maxLength / FRAME_SECONDS);
  }

  /** Feeds samples; returns the utterances that ended in them. */
  push(chunk: Float32Array): Utterance[] {
    const data = new Float32Array(this.carry.length + chunk.length);
    data.set(this.carry);
    data.set(chunk, this.carry.length);
    const done: Utterance[] = [];
    let offset = 0;
    for (; offset + this.frameSize <= data.length; offset += this.frameSize) {
      this.feed(data.subarray(offset, offset + this.frameSize), done);
    }
    this.carry = data.slice(offset);
    return done;
  }

  /** The utterance in progress, if it has enough speech. Call when the stream ends. */
  flush(): Utterance[] {
    const done: Utterance[] = [];
    this.finish(done);
    return done;
  }

  private feed(frame: Float32Array, done: Utterance[]): void {
    const loud = rms(frame) >= this.threshold;
    const frameStart = this.position;
    this.position += this.frameSize;
    if (this.frames.length === 0) {
      if (!loud) {
        this.preroll.push(frame.slice());
        if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
        return;
      }
      this.utteranceStart = frameStart - this.preroll.length * this.frameSize;
      this.frames = this.preroll;
      this.preroll = [];
    }
    this.frames.push(frame.slice());
    this.quiet = loud ? 0 : this.quiet + 1;
    if (loud) this.loudFrames++;
    if (this.quiet >= this.silenceFrames || this.frames.length >= this.maxFrames) this.finish(done);
  }

  private finish(done: Utterance[]): void {
    if (this.loudFrames >= this.minSpeechFrames) {
      const samples = new Float32Array(this.frames.length * this.frameSize);
      this.frames.forEach((frame, i) => samples.set(frame, i * this.frameSize));
      done.push({ samples, start: this.utteranceStart });
    }
    this.frames = [];
    this.quiet = 0;
    this.loudFrames = 0;
  }
}

/**
 * Maps wall-clock time to the video's own time, from samples taken while it plays. Audio that is
 * captured live carries wall-clock time only, and the viewer may pause, seek or change speed.
 */
export class MediaClock {
  private readonly points: { wall: number; media: number; rate: number }[] = [];

  constructor(private readonly capacity = 4000) {}

  /** `wall` in milliseconds, `media` in seconds. Call with increasing `wall`. */
  record(wall: number, media: number, rate = 1): void {
    this.points.push({ wall, media, rate });
    if (this.points.length > this.capacity) this.points.shift();
  }

  /** The video time that was playing at `wall`, or undefined before the first sample. */
  mediaAt(wall: number): number | undefined {
    const first = this.points[0];
    if (!first) return undefined;
    let point = first;
    for (const candidate of this.points) {
      if (candidate.wall > wall) break;
      point = candidate;
    }
    return Math.max(0, point.media + ((wall - point.wall) / 1000) * point.rate);
  }
}

/** One recognised line with wall-clock times (milliseconds). */
export interface SpokenLine {
  startWall: number;
  endWall: number;
  text: string;
}

/** Places lines on the video's timeline. Lines that can't be placed or have no text are dropped. */
export function placeSpokenLines(lines: readonly SpokenLine[], clock: MediaClock): Cue[] {
  const cues: Cue[] = [];
  for (const line of lines) {
    const start = clock.mediaAt(line.startWall);
    const end = clock.mediaAt(line.endWall);
    const text = line.text.trim();
    if (start === undefined || end === undefined || !text || end <= start) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

/** Whisper makes up lines for noise and music. These are the usual ones. */
const NOT_SPEECH = /^[\s♪♫♬~…・.,、。!?！？\-–—'"“”()（）\[\]【】]*$/;

/**
 * Places a speech engine's segments, timed from the start of the audio it was given, at `offset` seconds.
 * Empty and noise-only segments are dropped. A missing end (Whisper's last chunk) becomes start + 2 s;
 * the next line caps it anyway.
 */
export function segmentsToCues(segments: readonly { start: number; end: number | null; text: string }[], offset: number): Cue[] {
  return segments
    .map((s) => ({ start: offset + s.start, end: offset + (s.end ?? s.start + 2), text: s.text.trim() }))
    .filter((cue) => cue.text && !NOT_SPEECH.test(cue.text));
}

/**
 * Adds new lines to the transcript. A line that mostly covers time that already has one is dropped,
 * so rewatching a part doesn't duplicate it. Returns a new array sorted by start.
 */
export function addTranscribedCues(existing: readonly Cue[], incoming: readonly Cue[]): Cue[] {
  const covered = (cue: Cue) =>
    existing.some((other) => Math.min(other.end, cue.end) - Math.max(other.start, cue.start) > (cue.end - cue.start) / 2);
  return [...existing, ...incoming.filter((cue) => !covered(cue))].sort((a, b) => a.start - b.start);
}

/**
 * Mixes decoded audio to mono at `toRate` (Whisper takes 16 kHz) by averaging the samples each output
 * sample covers. A rough low-pass, enough for speech.
 */
export function mixToMono(channels: readonly Float32Array[], fromRate: number, toRate = 16000): Float32Array {
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(Math.floor((length * toRate) / fromRate));
  const step = fromRate / toRate;
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (const channel of channels) for (let j = from; j < to; j++) sum += channel[j]!;
    out[i] = sum / ((to - from) * channels.length);
  }
  return out;
}
