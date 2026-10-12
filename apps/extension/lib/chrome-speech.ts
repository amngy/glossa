import { localSpeechTag, startLocalOnly, type SpokenLine } from '@glossa/core';
import type { AsrEvent } from './asr';

/**
 * Speech recognition with Chrome's own on-device engine (Chrome 139+), for people who don't want to
 * install a Whisper pack. The language pack (about 60 MB) comes from Google once, when the viewer asks
 * for it in Settings. Recognition never runs in the cloud: see `startLocalOnly` in @glossa/core.
 */

/** The `pack` value that asks the offscreen document for this engine instead of a Whisper pack. */
export const CHROME_SPEECH = 'chrome';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(track: MediaStreamTrack): void;
  stop(): void;
}
interface RecognitionStatic {
  new (): Recognition;
  available(options: { langs: string[]; processLocally: boolean }): Promise<Availability>;
  install(options: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}
interface ResultEvent extends Event {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

const api = () => (globalThis as { SpeechRecognition?: RecognitionStatic }).SpeechRecognition;

/** Whether the on-device pack for `language` is installed, can be downloaded, or doesn't exist. */
export async function chromeSpeechAvailability(language: string): Promise<Availability> {
  const tag = localSpeechTag(language);
  const speech = api();
  if (!tag || !speech || typeof speech.available !== 'function') return 'unavailable';
  return speech.available({ langs: [tag], processLocally: true }).catch(() => 'unavailable' as const);
}

/** Downloads the pack from Google. Call from a click: the browser wants a user gesture. */
export async function installChromeSpeech(language: string): Promise<void> {
  const tag = localSpeechTag(language);
  const speech = api();
  if (!tag || !speech || typeof speech.install !== 'function') throw new Error('Chrome has no on-device speech recognition for this language.');
  if (!(await speech.install({ langs: [tag], processLocally: true }))) throw new Error('Chrome could not download the speech pack.');
}

/** Same shape as AsrSession (asr-capture.ts), so the offscreen document treats both alike. */
export class ChromeSpeechSession {
  private stream: MediaStream | null = null;
  private playback: AudioContext | null = null;
  private recognition: Recognition | null = null;
  private stopped = false;
  /** Wall-clock time of the first result seen at each result index; Chrome gives no audio times. */
  private readonly began = new Map<number, number>();

  constructor(
    readonly tabId: number,
    private readonly emit: (event: AsrEvent) => void,
    private readonly onEnd: () => void,
  ) {}

  async start(streamId: string, language: string): Promise<void> {
    const tag = localSpeechTag(language);
    if (!tag) throw new Error('Chrome’s on-device speech recognition doesn’t cover this language.');
    this.emit({ kind: 'loading', message: 'Starting Chrome’s speech recognition…' });
    const availability = await chromeSpeechAvailability(language);
    if (availability !== 'available') {
      throw new Error(
        availability === 'unavailable'
          ? 'This browser has no on-device speech recognition for this language.'
          : 'Download this language’s speech pack in Glossa’s settings first.',
      );
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    } as unknown as MediaStreamConstraints);
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('This tab has no audio to listen to.');
    track.addEventListener('ended', () => this.stop());
    // Tab audio is muted for the viewer while it's captured, unless it's played back here.
    this.playback = new AudioContext();
    this.playback.createMediaStreamSource(stream).connect(this.playback.destination);

    const Recognizer = api();
    if (!Recognizer) throw new Error('This browser has no speech recognition.');
    const recognition = new Recognizer();
    this.recognition = recognition;
    recognition.lang = tag;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.addEventListener('result', (event) => this.onResult(event as ResultEvent));
    recognition.addEventListener('error', (event) =>
      this.fail(`Speech recognition stopped: ${(event as Event & { error?: string }).error ?? 'unknown error'}`),
    );
    // Chrome ends a session now and then; start again on the same track, still on-device only.
    recognition.addEventListener('end', () => {
      if (this.stopped) return;
      this.began.clear();
      try {
        startLocalOnly(recognition, track);
      } catch (error) {
        this.fail(error instanceof Error ? error.message : String(error));
      }
    });
    startLocalOnly(recognition, track);
    this.emit({ kind: 'listening', language });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.recognition?.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.playback?.close();
    this.emit({ kind: 'stopped' });
    this.onEnd();
  }

  private fail(message: string): void {
    this.emit({ kind: 'error', message });
    this.stop();
  }

  private onResult({ resultIndex, results }: ResultEvent): void {
    const now = Date.now();
    const lines: SpokenLine[] = [];
    for (let i = resultIndex; i < results.length; i++) {
      const result = results[i]!;
      const start = this.began.get(i) ?? now;
      this.began.set(i, start);
      const text = result[0].transcript.trim();
      if (result.isFinal && text) lines.push({ startWall: start, endWall: Math.max(now, start + 500), text });
    }
    if (lines.length > 0) this.emit({ kind: 'lines', lines });
  }
}
