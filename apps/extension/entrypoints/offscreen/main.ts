import { browser } from '#imports';
import { japaneseReadings } from '@/lib/japanese-readings';
import { isOffscreenEnvelope, type OffscreenReply, type WorkerReply, type WorkerRequest } from '@/lib/on-device';

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

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || !isOffscreenEnvelope(message)) return;
  const { request } = message;
  if (request.type === 'readings') {
    japaneseReadings(request.text).then(
      (data) => sendResponse({ ok: true, data } satisfies OffscreenReply),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies OffscreenReply),
    );
    return true;
  }
  const id = nextId++;
  pending.set(id, sendResponse);
  worker.postMessage({ id, request } satisfies WorkerRequest);
  return true;
});
