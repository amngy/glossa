import type { SpokenLine } from '@glossa/core';

/**
 * Speech recognition for videos without subtitles. The offscreen document listens to a tab's audio and
 * runs Whisper on this device (entrypoints/asr-worker.ts); recognised lines travel back through the
 * background worker to the tab's content script. No audio leaves the device.
 */

export type AsrRequest =
  | { type: 'asr-start'; tabId: number; streamId: string; language: string; pack: string }
  | { type: 'asr-stop' };

export interface AsrStatus {
  /** The tab being transcribed, if any. */
  tabId: number | null;
}

export type AsrEvent =
  | { kind: 'loading'; message: string }
  | { kind: 'listening'; language: string }
  | { kind: 'lines'; lines: SpokenLine[] }
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

/** Between the offscreen document and the worker that runs the model. */
export type AsrWorkerRequest =
  | { type: 'load'; pack: string }
  | { type: 'transcribe'; id: number; samples: Float32Array; language: string };

export type AsrWorkerReply =
  | { type: 'ready' }
  | { type: 'error'; id?: number; message: string }
  | { type: 'lines'; id: number; chunks: { start: number; end: number | null; text: string }[] };
