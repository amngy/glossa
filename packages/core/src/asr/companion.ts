import type { SpeechSegment } from '../providers/types';

/** Name the companion registers under with the browser's native messaging. */
export const COMPANION_HOST = 'com.glossa.companion';

/**
 * Messages between the extension and the desktop companion, one JSON object each (the browser frames them).
 * Engine-neutral: any engine that takes 16 kHz mono f32 PCM and returns segments can sit behind it.
 */
export type CompanionRequest =
  | { id: number; type: 'ping' }
  | {
      id: number;
      type: 'transcribe';
      /** Base64 of little-endian f32 samples at 16 kHz, mono. See `encodePcm`. */
      pcm: string;
      language?: string;
    };

export type CompanionReply =
  | { type: 'ready'; engine: string }
  | { id: number; type: 'pong'; engine: string }
  | { id: number; type: 'segments'; language: string; segments: SpeechSegment[] }
  | { id: number; type: 'error'; message: string };

/** Samples as base64 of their little-endian f32 bytes (all supported platforms are little-endian). */
export function encodePcm(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  // Chunked so String.fromCharCode never gets too many arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Checks what came from the companion, which is outside our code, and returns null for anything unexpected. */
export function parseCompanionReply(value: unknown): CompanionReply | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.type === 'ready' && typeof m.engine === 'string') return { type: 'ready', engine: m.engine };
  if (typeof m.id !== 'number') return null;
  const id = m.id;
  if (m.type === 'pong' && typeof m.engine === 'string') return { id, type: 'pong', engine: m.engine };
  if (m.type === 'error' && typeof m.message === 'string') return { id, type: 'error', message: m.message };
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
