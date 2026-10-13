import { browser } from '#imports';
import {
  COMPANION_HOST,
  encodePcm,
  parseCompanionReply,
  type CompanionReply,
  type CompanionRequest,
  type SpeechModel,
  type SpeechOptions,
} from '@glossa/core';

/** Name of the port that carries live audio from the offscreen document to the background worker. */
export const COMPANION_STREAM = 'glossa-companion-stream';
export type CompanionStreamMessage = { language: string } | { pcm: string };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type Waiting = { resolve: (reply: CompanionReply) => void; reject: (error: Error) => void };

/**
 * Speech recognition by the desktop companion (apps/companion), over native messaging.
 * Audio goes to a program on this computer; it never touches the network.
 */
export class CompanionSpeechModel implements SpeechModel {
  readonly name = 'Desktop companion';
  private port: ReturnType<typeof browser.runtime.connectNative> | null = null;
  private waiting = new Map<number, Waiting>();
  /** Open live streams, by the id of their stream-start. */
  private streams = new Map<number, (reply: CompanionReply) => void>();
  private nextId = 1;

  private connect() {
    if (this.port) return this.port;
    // Needs the optional "nativeMessaging" permission; the browser throws without it.
    const port = browser.runtime.connectNative(COMPANION_HOST);
    port.onMessage.addListener((message: unknown) => {
      const reply = parseCompanionReply(message);
      if (reply && 'id' in reply) {
        this.streams.get(reply.id)?.(reply);
        this.waiting.get(reply.id)?.resolve(reply);
        this.waiting.delete(reply.id);
      }
    });
    port.onDisconnect.addListener(() => {
      const detail = browser.runtime.lastError?.message;
      const error = new Error(
        `The Glossa desktop companion isn’t running${detail ? ` (${detail})` : ''}. See the README to install it.`,
      );
      for (const w of this.waiting.values()) w.reject(error);
      this.waiting.clear();
      for (const [id, onReply] of this.streams) onReply({ id, type: 'error', message: error.message });
      this.streams.clear();
      this.port = null;
    });
    return (this.port = port);
  }

  private request(body: WithoutId<CompanionRequest>, signal?: AbortSignal): Promise<CompanionReply> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.waiting.set(id, { resolve, reject });
      signal?.addEventListener('abort', () => {
        this.waiting.delete(id);
        reject(signal.reason);
      });
      try {
        this.connect().postMessage({ ...body, id });
      } catch (error) {
        this.waiting.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Resolves with the engines' names once the companion answers (it loads its model first, a few seconds). */
  async ping(): Promise<{ engine: string; live?: string }> {
    // A companion stuck loading would otherwise stall look-ahead's start forever; 30 s covers a cold CPU load.
    const reply = await this.request({ type: 'ping' }, AbortSignal.timeout(30_000));
    if (reply.type !== 'pong') throw new Error('Unexpected reply from the companion.');
    return { engine: reply.engine, live: reply.live };
  }

  /** Opens a live stream. `onReply` gets its partial, final and error replies until `stop`. */
  stream(language: string, onReply: (reply: CompanionReply) => void) {
    const id = this.nextId++;
    const post = (body: WithoutId<CompanionRequest>) => {
      try {
        this.connect().postMessage({ ...body, id });
      } catch (error) {
        onReply({ id, type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };
    this.streams.set(id, onReply);
    post({ type: 'stream-start', language });
    return {
      push: (pcm: string) => post({ type: 'stream-audio', pcm }),
      stop: () => {
        if (this.streams.delete(id)) post({ type: 'stream-stop' });
      },
    };
  }

  async transcribe(pcm: Float32Array, options: SpeechOptions = {}) {
    const reply = await this.request(
      { type: 'transcribe', pcm: encodePcm(pcm), language: options.language },
      options.signal,
    );
    if (reply.type === 'error') throw new Error(reply.message);
    if (reply.type !== 'segments') throw new Error('Unexpected reply from the companion.');
    return { language: reply.language, segments: reply.segments };
  }
}
