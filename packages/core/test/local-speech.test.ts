import { describe, expect, it, vi } from 'vitest';
import { localSpeechTag, startLocalOnly } from '../src';

const track = {} as MediaStreamTrack;

describe('startLocalOnly', () => {
  it('turns processLocally on before starting', () => {
    const recognizer = { processLocally: false, start: vi.fn(() => expect(recognizer.processLocally).toBe(true)) };
    startLocalOnly(recognizer, track);
    expect(recognizer.start).toHaveBeenCalledWith(track);
  });

  it('never starts a recognizer that has no processLocally', () => {
    const start = vi.fn();
    expect(() => startLocalOnly({ start }, track)).toThrow(/never uses the cloud/);
    expect(start).not.toHaveBeenCalled();
  });

  it('never starts one that refuses to stay local', () => {
    const start = vi.fn();
    const stubborn = { get processLocally() { return false; }, set processLocally(_: boolean | undefined) {}, start };
    expect(() => startLocalOnly(stubborn, track)).toThrow();
    expect(start).not.toHaveBeenCalled();
  });
});

describe('localSpeechTag', () => {
  it('maps base languages and rejects Arabic', () => {
    expect(localSpeechTag('ja')).toBe('ja-JP');
    expect(localSpeechTag('pt-PT')).toBe('pt-BR');
    expect(localSpeechTag('ar')).toBeUndefined();
  });
});
