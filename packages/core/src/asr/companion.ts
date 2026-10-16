import type { SpeechSegment } from '../providers/types';

/** Name the companion registers under with the browser's native messaging. */
export const COMPANION_HOST = 'com.glossa.companion';
/** Port the companion listens on (127.0.0.1 only) when started with --serve. */
export const COMPANION_PORT = 47843;

/**
 * Messages between the extension and the desktop companion, one JSON object each (the browser frames them).
 * Engine-neutral: any engine that takes 16 kHz mono f32 PCM and returns segments can sit behind it.
 * `pcm` is always base64 of little-endian f32 samples at 16 kHz, mono (see `encodePcm`).
 *
 * Live mode: `stream-start` opens a stream under its id, `stream-audio` (same id) adds audio in order, and
 * the companion answers with `partial` (its current guess at the line being spoken) and `final` (a settled
 * line, timed in seconds from the stream's first sample), until `stream-stop`.
 */
export type CompanionRequest =
  | { id: number; type: 'ping' }
  | { id: number; type: 'transcribe'; pcm: string; language?: string }
  | { id: number; type: 'stream-start'; language?: string }
  | { id: number; type: 'stream-audio'; pcm: string }
  | { id: number; type: 'stream-stop' };

export type CompanionReply =
  | { type: 'ready'; engine: string }
  /** `live` names the engine for live mode, if the companion has one. */
  | { id: number; type: 'pong'; engine: string; live?: string }
  | { id: number; type: 'segments'; language: string; segments: SpeechSegment[] }
  | { id: number; type: 'partial'; text: string }
  | ({ id: number; type: 'final' } & SpeechSegment)
  | { id: number; type: 'error'; message: string };

/** Samples as base64 of their little-endian f32 bytes (all supported platforms are little-endian). */
export function encodePcm(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  // Chunked so String.fromCharCode never gets too many arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodePcm(base64: string): Float32Array {
  return new Float32Array(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer);
}

/** Checks what came from the companion, which is outside our code, and returns null for anything unexpected. */
export function parseCompanionReply(value: unknown): CompanionReply | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.type === 'ready' && typeof m.engine === 'string') return { type: 'ready', engine: m.engine };
  if (typeof m.id !== 'number') return null;
  const id = m.id;
  if (m.type === 'pong' && typeof m.engine === 'string') {
    return typeof m.live === 'string' ? { id, type: 'pong', engine: m.engine, live: m.live } : { id, type: 'pong', engine: m.engine };
  }
  if (m.type === 'error' && typeof m.message === 'string') return { id, type: 'error', message: m.message };
  if (m.type === 'partial' && typeof m.text === 'string') return { id, type: 'partial', text: m.text };
  if (m.type === 'final' && typeof m.start === 'number' && typeof m.end === 'number' && typeof m.text === 'string') {
    return { id, type: 'final', start: m.start, end: m.end, text: m.text };
  }
  if (m.type === 'segments' && typeof m.language === 'string' && Array.isArray(m.segments)) {
    const segments = m.segments as Record<string, unknown>[];
    const valid = segments.every(
      (s) => typeof s?.start === 'number' && typeof s.end === 'number' && typeof s.text === 'string',
    );
    if (valid) {
      return {
        id,
        type: 'segments',
        language: m.language,
        segments: segments.map((s) => ({ start: s.start as number, end: s.end as number, text: s.text as string })),
      };
    }
  }
  return null;
}
