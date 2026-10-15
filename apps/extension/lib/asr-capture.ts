import { browser, type Browser } from '#imports';
import { COMPANION_HOST, encodePcm, Endpointer, mixToMono, segmentsToCues, type CompanionReply, type SpokenLine } from '@glossa/core';
import { fromBase64, type AheadAudio, type AsrEvent, type AsrWorkerReply, type AsrWorkerRequest } from './asr';
import { COMPANION_STREAM, type CompanionStreamMessage } from './companion';
import { sendMessage } from './messages';

/** Whisper's input rate. */
const SAMPLE_RATE = 16000;
/** Utterances waiting for the model beyond this are dropped: the model can't keep up, and old lines are stale. */
const MAX_BACKLOG = 4;
/** Look-ahead audio arrives faster than it plays, so more may wait; none of it is stale yet. */
const MAX_AHEAD_BACKLOG = 40;
/** Decoded audio that doesn't continue the previous chunk within this (seconds) starts a new run, e.g. after a seek. */
const MAX_GAP = 0.1;

interface Waiting {
  /** Where the utterance starts: wall-clock ms for captured audio, media seconds for look-ahead audio. */
  startWall?: number;
  startMedia?: number;
}

/** One SourceBuffer's look-ahead audio, decoded and cut at pauses on its media timeline. */
interface AheadStream {
  decoder: AudioDecoder;
  endpointer: Endpointer;
  /** Media time of the endpointer's first sample, and of the end of the audio fed so far. */
  start: number;
  end: number;
}

/**
 * Listens to one tab's audio and turns it into recognised lines: tab audio → utterances (cut at pauses)
 * → Whisper in a worker → lines with wall-clock times. The tab keeps playing for the viewer.
 * Without a stream, the page sends the audio instead (`feed`): frames YouTube's player has buffered
 * ahead of the playhead, decoded here, so lines carry media times and can be ready before they're spoken.
 * Those can go to the desktop companion instead of Whisper; the background worker holds its connection.
 * Captured audio can go to the companion too, as one live stream that it cuts into lines itself.
 */
export class AsrSession {
  private worker: Worker | null = null;
  private streams: MediaStream | null = null;
  private contexts: AudioContext[] = [];
  private stopped = false;
  /**
   * Set while the viewer replays audio that was already transcribed. The recogniser then gets silence:
   * dropping the audio would shift every later line's time, and Whisper skips silence anyway.
   */
  hold = false;

  private readonly endpointer = new Endpointer({ sampleRate: SAMPLE_RATE });
  /** Wall-clock time (ms) of the audio clock's zero, and the audio time of the first block. */
  private clockBase = 0;
  private firstBlockTime: number | null = null;

  private readonly waiting = new Map<number, Waiting>();
  private nextId = 0;
  private busy = false;
  private queue: ({ id: number; samples: Float32Array } & Waiting)[] = [];
  private language = '';
  private fromPage = false;
  private companion = false;
  private live: Browser.runtime.Port | null = null;
  private readonly ahead = new Map<number, AheadStream>();

  constructor(
    readonly tabId: number,
    private readonly emit: (event: AsrEvent) => void,
    private readonly onEnd: () => void,
  ) {}

  async start(streamId: string | undefined, language: string, pack: string, notice?: string): Promise<void> {
    this.language = language;
    this.fromPage = !streamId;
    this.emit({ kind: 'loading', message: notice ?? 'Loading the speech model…' });
    if (pack === COMPANION_HOST && streamId) this.openLive();
    if (streamId) await this.capture(streamId);
    if (pack === COMPANION_HOST) {
      // The background worker already reached the companion, so its model is loaded.
      this.companion = true;
      this.onReply({ type: 'ready' });
      return;
    }

    const worker = new Worker(browser.runtime.getURL('/asr-worker.js'));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<AsrWorkerReply>) => this.onReply(event.data);
    worker.onerror = (event) => this.fail(`Speech recognition stopped: ${event.message}`);
    worker.postMessage({ type: 'load', pack } satisfies AsrWorkerRequest);
  }

  /** Live mode: the companion answers the streamed audio with partial and settled lines, timed from its first sample. */
  private openLive(): void {
    const port = browser.runtime.connect({ name: COMPANION_STREAM });
    this.live = port;
    port.onMessage.addListener((reply: CompanionReply) => {
      if (this.stopped) return;
      if (reply.type === 'partial') this.emit({ kind: 'partial', text: reply.text });
      else if (reply.type === 'error') this.fail(reply.message);
      else if (reply.type === 'final') {
        const line = { startWall: this.wallOf(reply.start * SAMPLE_RATE), endWall: this.wallOf(reply.end * SAMPLE_RATE), text: reply.text };
        this.emit({ kind: 'lines', lines: [line] });
      }
    });
    port.onDisconnect.addListener(() => {
      if (!this.stopped) this.fail('The desktop companion stopped.');
    });
    port.postMessage({ language: this.language } satisfies CompanionStreamMessage);
  }

  private async capture(streamId: string): Promise<void> {
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
      const samples = this.hold ? new Float32Array(event.data.samples.length) : event.data.samples;
      if (this.live) return this.live.postMessage({ pcm: encodePcm(samples) } satisfies CompanionStreamMessage);
      for (const utterance of this.endpointer.push(samples)) {
        this.enqueue({ samples: utterance.samples, startWall: this.wallOf(utterance.start) });
      }
    };
  }

  /** Look-ahead audio from the page. Each SourceBuffer gets its own decoder and endpointer. */
  feed(audio: AheadAudio): void {
    if (this.stopped || !this.fromPage) return;
    let stream = this.ahead.get(audio.buffer);
    if (!stream) {
      const decoder = new AudioDecoder({
        output: (data) => this.onDecoded(audio.buffer, data),
        // The buffer's next frames start a new decoder.
        error: () => this.ahead.delete(audio.buffer),
      });
      decoder.configure({
        codec: 'opus',
        sampleRate: audio.sampleRate,
        numberOfChannels: audio.channels,
        description: audio.description ? fromBase64(audio.description) : undefined,
      });
      stream = { decoder, endpointer: new Endpointer({ sampleRate: SAMPLE_RATE }), start: 0, end: -Infinity };
      this.ahead.set(audio.buffer, stream);
    }
    for (const frame of audio.frames) {
      stream.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(frame.time * 1e6), data: fromBase64(frame.data) }));
    }
  }

  private onDecoded(buffer: number, data: AudioData): void {
    const channels = Array.from({ length: data.numberOfChannels }, (_, planeIndex) => {
      const plane = new Float32Array(data.numberOfFrames);
      data.copyTo(plane, { planeIndex, format: 'f32-planar' });
      return plane;
    });
    const time = data.timestamp / 1e6;
    const end = time + data.numberOfFrames / data.sampleRate;
    const samples = mixToMono(channels, data.sampleRate, SAMPLE_RATE);
    data.close();
    const stream = this.ahead.get(buffer);
    if (!stream || this.stopped) return;
    const enqueue = (utterances: { samples: Float32Array; start: number }[]) => {
      for (const { samples, start } of utterances) this.enqueue({ samples, startMedia: stream.start + start / SAMPLE_RATE });
    };
    if (Math.abs(time - stream.end) > MAX_GAP) {
      enqueue(stream.endpointer.flush());
      stream.endpointer = new Endpointer({ sampleRate: SAMPLE_RATE });
      stream.start = time;
    }
    stream.end = end;
    enqueue(stream.endpointer.push(samples));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.worker?.terminate();
    this.live?.disconnect();
    for (const { decoder } of this.ahead.values()) if (decoder.state !== 'closed') decoder.close();
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

  private enqueue(utterance: { samples: Float32Array } & Waiting): void {
    if (this.queue.length >= (this.fromPage ? MAX_AHEAD_BACKLOG : MAX_BACKLOG)) this.queue.shift();
    this.queue.push({ id: this.nextId++, ...utterance });
    this.pump();
  }

  private pump(): void {
    const next = this.queue[0];
    if (this.busy || !this.ready || !next || !(this.worker || this.companion)) return;
    this.queue.shift();
    this.busy = true;
    this.waiting.set(next.id, { startWall: next.startWall, startMedia: next.startMedia });
    if (this.companion) {
      sendMessage('companionTranscribe', { pcm: encodePcm(next.samples), language: this.language }).then(
        ({ segments }) => this.onReply({ type: 'lines', id: next.id, chunks: segments }),
        (error: unknown) => this.onReply({ type: 'error', id: next.id, message: error instanceof Error ? error.message : String(error) }),
      );
      return;
    }
    this.worker?.postMessage({ type: 'transcribe', id: next.id, samples: next.samples, language: this.language } satisfies AsrWorkerRequest, [
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
      const { startMedia, startWall } = waiting;
      if (startMedia !== undefined) {
        const cues = segmentsToCues(reply.chunks, startMedia);
        if (cues.length > 0) this.emit({ kind: 'cues', cues });
      } else if (startWall !== undefined) {
        const lines: SpokenLine[] = segmentsToCues(reply.chunks, 0).map((cue) => ({
          startWall: startWall + cue.start * 1000,
          endWall: startWall + cue.end * 1000,
          text: cue.text,
        }));
        if (lines.length > 0) this.emit({ kind: 'lines', lines });
      }
    }
    this.pump();
  }
}
