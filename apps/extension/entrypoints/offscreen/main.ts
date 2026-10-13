import { browser } from '#imports';
import { japaneseReadings } from '@/lib/japanese-readings';
import { isOffscreenEnvelope, type OffscreenReply, type WorkerReply, type WorkerRequest } from '@/lib/on-device';
import { isAheadAudio, type AsrEnvelope, type AsrEvent } from '@/lib/asr';
import { AsrSession } from '@/lib/asr-capture';

/**
 * Hosts the worker that runs Glossa's on-device model (entrypoints/llm-worker.ts) and relays the
 * background worker's requests to it. Service workers can't start workers themselves, and would drop
 * the model from GPU memory whenever the browser stops them.
 */

const worker = new Worker(browser.runtime.getURL('/llm-worker.js'));
const pending = new Map<number, (reply: OffscreenReply) => void>();
let nextId = 0;

worker.onmessage = (event: MessageEvent<WorkerReply>) => {
  pending.get(event.data.id)?.(event.data.reply);
  pending.delete(event.data.id);
};
worker.onerror = (event) => {
  // The worker failed to start or crashed: fail everything waiting on it.
  for (const resolve of pending.values()) resolve({ ok: false, error: `The on-device model stopped: ${event.message}` });
  pending.clear();
};

let asr: AsrSession | null = null;

function tellTab(tabId: number, event: AsrEvent): void {
  void browser.runtime.sendMessage({ glossaAsr: true, tabId, event } satisfies AsrEnvelope).catch(() => {});
}

function startAsr(tabId: number, streamId: string | undefined, language: string, pack: string): Promise<void> {
  asr?.stop();
  const session = new AsrSession(
    tabId,
    (event) => tellTab(tabId, event),
    () => {
      if (asr === session) asr = null;
    },
  );
  asr = session;
  return session.start(streamId, language, pack).catch((error: unknown) => {
    tellTab(tabId, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
    session.stop();
  });
}

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id) return;
  // Look-ahead audio comes straight from the YouTube tab's content script, in order; only that tab's is used.
  if (isAheadAudio(message)) {
    if (asr && asr.tabId === sender.tab?.id) asr.feed(message);
    return;
  }
  if (!isOffscreenEnvelope(message)) return;
  const { request } = message;
  if (request.type === 'readings') {
    japaneseReadings(request.text).then(
      (data) => sendResponse({ ok: true, data } satisfies OffscreenReply),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies OffscreenReply),
    );
    return true;
  }
  if (request.type === 'asr-start') {
    void startAsr(request.tabId, request.streamId, request.language, request.pack);
    sendResponse({ ok: true, data: null } satisfies OffscreenReply);
    return;
  }
  if (request.type === 'asr-stop') {
    asr?.stop();
    sendResponse({ ok: true, data: null } satisfies OffscreenReply);
    return;
  }
  const id = nextId++;
  pending.set(id, sendResponse);
  worker.postMessage({ id, request } satisfies WorkerRequest);
  return true;
});
