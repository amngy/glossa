import { describe, expect, it } from 'vitest';
import { decodePcm, encodePcm, parseCompanionReply } from '../src';

describe('encodePcm', () => {
  it('round-trips samples as little-endian f32', () => {
    const pcm = Float32Array.from({ length: 70000 }, (_, i) => Math.sin(i)); // longer than one chunk
    const bytes = Uint8Array.from(Buffer.from(encodePcm(pcm), 'base64'));
    expect(new Float32Array(bytes.buffer)).toEqual(pcm);
    expect(decodePcm(encodePcm(pcm))).toEqual(pcm);
  });
});

describe('parseCompanionReply', () => {
  it('accepts well-formed replies', () => {
    const segments = [{ start: 0, end: 1.5, text: 'こんにちは' }];
    expect(parseCompanionReply({ id: 3, type: 'segments', language: 'ja', segments, extra: 1 })).toEqual({
      id: 3,
      type: 'segments',
      language: 'ja',
      segments,
    });
    expect(parseCompanionReply({ type: 'ready', engine: 'x' })).toEqual({ type: 'ready', engine: 'x' });
    expect(parseCompanionReply({ id: 1, type: 'pong', engine: 'w', live: 'n' })).toEqual({ id: 1, type: 'pong', engine: 'w', live: 'n' });
    expect(parseCompanionReply({ id: 1, type: 'pong', engine: 'w', live: null })).toEqual({ id: 1, type: 'pong', engine: 'w' });
    expect(parseCompanionReply({ id: 2, type: 'partial', text: 'この' })).toEqual({ id: 2, type: 'partial', text: 'この' });
    expect(parseCompanionReply({ id: 2, type: 'final', start: 4.08, end: 6.08, text: 'このケーキ' })).toEqual({
      id: 2,
      type: 'final',
      start: 4.08,
      end: 6.08,
      text: 'このケーキ',
    });
  });

  it('rejects anything else', () => {
    expect(parseCompanionReply(null)).toBeNull();
    expect(parseCompanionReply({ type: 'segments', language: 'ja', segments: [] })).toBeNull(); // no id
    expect(parseCompanionReply({ id: 1, type: 'segments', language: 'ja', segments: [{ start: 0 }] })).toBeNull();
    expect(parseCompanionReply({ id: 1, type: 'nope' })).toBeNull();
    expect(parseCompanionReply({ id: 1, type: 'partial' })).toBeNull();
    expect(parseCompanionReply({ id: 1, type: 'final', start: '0', end: 1, text: 'x' })).toBeNull();
  });
});
