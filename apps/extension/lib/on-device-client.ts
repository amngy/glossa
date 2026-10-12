import { browser, type Browser } from '#imports';
import type { ChatModel } from '@glossa/core';
import type { OffscreenEnvelope, OffscreenReply, OffscreenRequest, ReadingsRequest } from './on-device';
import { findOnDeviceModel } from './on-device-models';

/** Background side of the on-device model, which runs in an offscreen document (see entrypoints/offscreen). */

const OFFSCREEN_PATH = '/offscreen.html';
let creating: Promise<void> | undefined;

async function ensureOffscreen(): Promise<void> {
  if (!browser.offscreen) throw new Error('Glossa’s on-device model needs Chrome or Edge for now.');
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (contexts.length > 0) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS' as Browser.offscreen.Reason],
      justification: 'Runs Glossa’s on-device AI model in a worker on the GPU.',
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}

async function send(request: OffscreenRequest | ReadingsRequest): Promise<OffscreenReply | undefined> {
  // Right after it's created, the document may still be loading its script and not listening yet.
  for (let attempt = 0; ; attempt++) {
    try {
      return (await browser.runtime.sendMessage({ glossaOffscreen: true, request } satisfies OffscreenEnvelope)) as
        | OffscreenReply
        | undefined;
    } catch (error) {
      if (attempt >= 20 || !String(error).includes('Receiving end does not exist')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function askOffscreen<T>(request: OffscreenRequest | ReadingsRequest): Promise<T> {
  await ensureOffscreen();
  const reply = await send(request);
  if (!reply) throw new Error('Glossa’s on-device model didn’t respond. Try again.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

export class OnDeviceChatModel implements ChatModel {
  readonly name: string;

  constructor(private readonly model: string) {
    this.name = `${findOnDeviceModel(model).name} on this device`;
  }

  complete(system: string, prompt: string): Promise<string> {
    return askOffscreen<string>({ type: 'complete', model: this.model, system, prompt });
  }
}
