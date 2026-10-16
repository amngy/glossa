import { describe, expect, it, vi } from 'vitest';
import { localSpeechTag, speechPhrases, startLocalOnly } from '../src';

describe('speechPhrases', () => {
  const saved = [
    { word: '気', lang: 'ja' },
    { word: 'hola', lang: 'es' },
    { word: '帰る', lang: 'ja-JP' },
    { word: '気', lang: 'ja' },
  ];
  it('puts the title first, then saved words of that language, newest first, without duplicates', () => {
    expect(speechPhrases(' 進撃の巨人 ', saved, 'ja')).toEqual(['進撃の巨人', '気', '帰る']);
  });
  it('caps the list and skips an empty title', () => {
    expect(speechPhrases(undefined, saved, 'ja', 1)).toEqual(['気']);
  });
});

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
