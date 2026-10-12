import { browser } from '#imports';
import { Endpointer, type SpokenLine } from '@glossa/core';
import type { AsrEvent, AsrWorkerReply, AsrWorkerRequest } from './asr';

/** Whisper's input rate. */
const SAMPLE_RATE = 16000;
/** Utterances waiting for the model beyond this are dropped: the model can't keep up, and old lines are stale. */
const MAX_BACKLOG = 4;

/** Whisper makes up lines for noise and music. These are the usual ones. */
const NOT_SPEECH = /^[\s♪♫♬~…・.,、。!?！？\-–—'"“”()（）\[\]【】]*$/;

interface Waiting {
  startWall: number;
}

/**
 * Listens to one tab's audio and turns it into recognised lines: tab audio → utterances (cut at pauses)
 * → Whisper in a worker → lines with wall-clock times. The tab keeps playing for the viewer.
 */
export class AsrSession {
  private worker: Worker | null = null;
  private streams: MediaStream | null = null;
  private contexts: AudioContext[] = [];
  private stopped = false;

  private readonly endpointer = new Endpointer({ sampleRate: SAMPLE_RATE });
  /** Wall-clock time (ms) of the audio clock's zero, and the audio time of the first block. */
  private clockBase = 0;
  private firstBlockTime: number | null = null;

  private readonly waiting = new Map<number, Waiting>();
  private nextId = 0;
  private busy = false;
  private queue: { id: number; samples: Float32Array; startWall: number }[] = [];
  private language = '';

  constructor(
    readonly tabId: number,
    private readonly emit: (event: AsrEvent) => void,
    private readonly onEnd: () => void,
  ) {}

  async start(streamId: string, language: string, pack: string): Promise<void> {
    this.language = language;
    this.emit({ kind: 'loading', message: 'Loading the speech model…' });
    // Tab audio is muted for the viewer while it's captured, unless it's played back here.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    } as unknown as MediaStreamConstraints);
    this.streams = stream;
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stop());

    const playback = new AudioContext();
    playback.createMediaStreamSource(stream).connect(playback.destination);
    const analysis = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.contexts = [playback, analysis];
    await analysis.audioWorklet.addModule(browser.runtime.getURL('/asr-worklet.js'));
    const capture = new AudioWorkletNode(analysis, 'glossa-capture');
    const mute = analysis.createGain();
    mute.gain.value = 0;
    analysis.createMediaStreamSource(stream).connect(capture);
    capture.connect(mute).connect(analysis.destination);
    this.clockBase = Date.now() - analysis.currentTime * 1000;
    capture.port.onmessage = (event: MessageEvent<{ samples: Float32Array; time: number }>) => {
      if (this.stopped) return;
      if (this.firstBlockTime === null) this.firstBlockTime = event.data.time;
      for (const utterance of this.endpointer.push(event.data.samples)) this.enqueue(utterance.samples, utterance.start);
    };

    const worker = new Worker(browser.runtime.getURL('/asr-worker.js'));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<AsrWorkerReply>) => this.onReply(event.data);
    worker.onerror = (event) => this.fail(`Speech recognition stopped: ${event.message}`);
    worker.postMessage({ type: 'load', pack } satisfies AsrWorkerRequest);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.worker?.terminate();
    this.streams?.getTracks().forEach((track) => track.stop());
    for (const context of this.contexts) void context.close();
    this.emit({ kind: 'stopped' });
    this.onEnd();
  }

  private fail(message: string): void {
    this.emit({ kind: 'error', message });
    this.stop();
  }

  private wallOf(sample: number): number {
    return this.clockBase + ((this.firstBlockTime ?? 0) + sample / SAMPLE_RATE) * 1000;
  }

  private enqueue(samples: Float32Array, start: number): void {
    if (this.queue.length >= MAX_BACKLOG) this.queue.shift();
    this.queue.push({ id: this.nextId++, samples, startWall: this.wallOf(start) });
    this.pump();
  }

  private pump(): void {
    const next = this.queue[0];
    if (this.busy || !this.ready || !next || !this.worker) return;
    this.queue.shift();
    this.busy = true;
    this.waiting.set(next.id, { startWall: next.startWall });
    this.worker.postMessage({ type: 'transcribe', id: next.id, samples: next.samples, language: this.language } satisfies AsrWorkerRequest, [
      next.samples.buffer,
    ]);
  }

  private ready = false;

  private onReply(reply: AsrWorkerReply): void {
    if (this.stopped) return;
    if (reply.type === 'ready') {
      this.ready = true;
      this.emit({ kind: 'listening', language: this.language });
      this.pump();
      return;
    }
    if (reply.type === 'error') {
      if (reply.id === undefined) this.fail(reply.message);
      else {
        this.waiting.delete(reply.id);
        this.busy = false;
        this.emit({ kind: 'error', message: reply.message });
        this.pump();
      }
      return;
    }
    const waiting = this.waiting.get(reply.id);
    this.waiting.delete(reply.id);
    this.busy = false;
    if (waiting) {
      const lines: SpokenLine[] = [];
      for (const chunk of reply.chunks) {
        const text = chunk.text.trim();
        if (!text || NOT_SPEECH.test(text)) continue;
        lines.push({
          startWall: waiting.startWall + chunk.start * 1000,
          // The last chunk of an utterance has no end time; the next utterance's start would cap it anyway.
          endWall: waiting.startWall + (chunk.end ?? chunk.start + 2) * 1000,
          text,
        });
      }
      if (lines.length > 0) this.emit({ kind: 'lines', lines });
    }
    this.pump();
  }
}
