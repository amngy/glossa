import type { Cue, SpokenLine } from '@glossa/core';

/**
 * Speech recognition for videos without subtitles. The offscreen document listens to a tab's audio and
 * runs Whisper on this device (entrypoints/asr-worker.ts); recognised lines travel back through the
 * background worker to the tab's content script. No audio leaves the device.
 */

export type AsrRequest =
  /**
   * Without `streamId`, the audio comes from the page as `AheadAudio` (look-ahead on YouTube, #44).
   * `pack` is a Whisper pack id, CHROME_SPEECH, or COMPANION_HOST for the desktop companion.
   * `notice` replaces the usual loading message. `phrases` bias Chrome's recognizer (the video title, saved words).
   */
  | { type: 'asr-start'; tabId: number; streamId?: string; language: string; pack: string; notice?: string; phrases?: string[] }
  | { type: 'asr-stop' }
  /** While the viewer replays audio that was already transcribed, the recogniser gets silence instead. */
  | { type: 'asr-hold'; hold: boolean };

export interface AsrStatus {
  /** The tab being transcribed, if any. */
  tabId: number | null;
}

export type AsrEvent =
  | { kind: 'loading'; message: string }
  | { kind: 'listening'; language: string }
  | { kind: 'lines'; lines: SpokenLine[] }
  /** Lines already on the video's timeline, from audio read ahead of the playhead. */
  | { kind: 'cues'; cues: Cue[] }
  /** The current best guess for the line being spoken; it may change with the next update. Empty: the line ended without a final. */
  | { kind: 'partial'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'stopped' };

/** From the offscreen document to the background worker, which passes it on to the tab. */
export interface AsrEnvelope {
  glossaAsr: true;
  tabId: number;
  event: AsrEvent;
}

export function isAsrEnvelope(message: unknown): message is AsrEnvelope {
  return typeof message === 'object' && message !== null && (message as AsrEnvelope).glossaAsr === true;
}

/**
 * Audio frames the YouTube content script read from the player's appends, sent straight to the offscreen
 * document. `description` is the OpusHead or AAC's AudioSpecificConfig, `time` is media time in seconds; bytes are base64.
 */
export interface AheadAudio {
  glossaAhead: true;
  /** WebCodecs codec string: `opus` or `mp4a.40.*`. */
  codec: string;
  /** The page's SourceBuffer number; each has its own decoder. */
  buffer: number;
  sampleRate: number;
  channels: number;
  description?: string;
  frames: { time: number; data: string }[];
}

export function isAheadAudio(message: unknown): message is AheadAudio {
  return typeof message === 'object' && message !== null && (message as AheadAudio).glossaAhead === true;
}

// Extension messages are JSON, so bytes travel as base64.
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** Between the offscreen document and the worker that runs the model. */
export type AsrWorkerRequest =
  | { type: 'load'; pack: string }
  | { type: 'transcribe'; id: number; samples: Float32Array; language: string };

export type AsrWorkerReply =
  | { type: 'ready' }
  | { type: 'error'; id?: number; message: string }
  | { type: 'lines'; id: number; chunks: { start: number; end: number | null; text: string }[] };
