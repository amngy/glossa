import { browser } from '#imports';
import type { DictionaryEntry, ExplainRequest, ReadingToken, SpeechSegment, TranslationRequest } from '@glossa/core';
import type { AsrStatus } from './asr';
import type { OnDeviceStatus } from './on-device';

/** Requests that pages and content scripts send to the background worker. */
export interface MessageMap {
  translate: { request: TranslationRequest; response: string };
  lookup: { request: { word: string; lang: string }; response: DictionaryEntry[] };
  /** The same lookup, answered by the configured AI model. */
  lookupAi: { request: { word: string; lang: string }; response: DictionaryEntry[] };
  explain: { request: ExplainRequest; response: string };
  /** Runs a tiny request against the configured AI provider. */
  testAi: { request: null; response: string };
  /** Runs a tiny request against the configured translator. */
  testTranslator: { request: null; response: string };
  openOptions: { request: null; response: null };
  /** The on-device model, by id from ON_DEVICE_MODELS. */
  onDeviceStatus: { request: { model: string }; response: OnDeviceStatus };
  /** Starts the download; follow it with onDeviceStatus. */
  onDeviceDownload: { request: { model: string }; response: null };
  onDeviceDelete: { request: { model: string }; response: null };
  /** Readings for a Japanese line, from the installed "Japanese readings" pack. */
  readings: { request: { text: string }; response: ReadingToken[] };
  /**
   * Starts recognising the speech in a tab's audio. `streamId` comes from tabCapture.getMediaStreamId;
   * without it, the YouTube page sends the audio its player has buffered (look-ahead).
   */
  asrStart: { request: { tabId: number; streamId?: string; language: string; pack: string }; response: null };
  asrStop: { request: null; response: null };
  /** Pauses recognition while the viewer replays a part that was already transcribed. */
  asrHold: { request: { hold: boolean }; response: null };
  /** Starts the desktop companion if needed and returns its engines' names. Needs the nativeMessaging permission. */
  companionPing: { request: null; response: { engine: string; live?: string } };
  /** From the offscreen document: one utterance for the companion, `pcm` as from `encodePcm`. */
  companionTranscribe: { request: { pcm: string; language: string }; response: { language: string; segments: SpeechSegment[] } };
  asrStatus: { request: null; response: AsrStatus };
}

export type MessageType = keyof MessageMap;

interface Envelope {
  glossa: true;
  type: MessageType;
  payload: unknown;
}

type Reply = { ok: true; data: unknown } | { ok: false; error: string };

function isEnvelope(message: unknown): message is Envelope {
  return typeof message === 'object' && message !== null && (message as Envelope).glossa === true;
}

export async function sendMessage<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request'],
): Promise<MessageMap[T]['response']> {
  const reply = (await browser.runtime.sendMessage({ glossa: true, type, payload } satisfies Envelope)) as
    | Reply
    | undefined;
  if (!reply) throw new Error('Glossa’s background worker did not respond. Try reloading the page.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as MessageMap[T]['response'];
}

export type MessageHandlers = {
  [T in MessageType]: (payload: MessageMap[T]['request']) => Promise<MessageMap[T]['response']>;
};

export function handleMessages(handlers: MessageHandlers): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !isEnvelope(message)) return;
    const handler = handlers[message.type] as ((payload: unknown) => Promise<unknown>) | undefined;
    if (!handler) return;
    handler(message.payload).then(
      (data) => sendResponse({ ok: true, data } satisfies Reply),
      (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Reply),
    );
    return true; // keeps the channel open for the async response
  });
}
