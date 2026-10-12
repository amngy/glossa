import { builder, type Tokenizer, type IpadicFeatures } from '@sglkc/kuromoji';
import type { ReadingToken } from '@glossa/core';
import { isPackInstalled, JAPANESE_READINGS, readPackFile } from './packs';

/**
 * Japanese readings from the "Japanese readings" pack, using kuromoji. It runs in the offscreen
 * document (entrypoints/offscreen): the dictionary takes a lot of memory once loaded, and a service
 * worker would lose it whenever the browser stops it.
 */

let tokenizer: Promise<Tokenizer<IpadicFeatures>> | undefined;

async function load(): Promise<Tokenizer<IpadicFeatures>> {
  if (!(await isPackInstalled(JAPANESE_READINGS))) {
    throw new Error('The Japanese readings pack isn’t installed. Install it in Glossa’s settings.');
  }
  return new Promise((resolve, reject) => {
    // kuromoji's browser loader fetches `<dicPath>/<file>` and collapses repeated slashes (so a scheme
    // like https:// would be mangled); serve those from the installed pack instead.
    const dicPath = '/glossa-packs/japanese-readings/';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(dicPath)) return realFetch(input, init);
      const bytes = await readPackFile(JAPANESE_READINGS, url.slice(dicPath.length));
      return bytes ? new Response(bytes) : new Response(null, { status: 404, statusText: 'Not installed' });
    };
    builder({ dicPath }).build((error, built) => {
      globalThis.fetch = realFetch;
      if (error) reject(new Error(`Couldn’t load the Japanese readings: ${error instanceof Error ? error.message : String(error)}`));
      else resolve(built);
    });
  });
}

/** Readings for each word of `text`, in order. The surfaces join back into `text`. */
export async function japaneseReadings(text: string): Promise<ReadingToken[]> {
  tokenizer ??= load().catch((error: unknown) => {
    tokenizer = undefined; // try again next time, e.g. after the pack is installed
    throw error;
  });
  const built = await tokenizer;
  return built.tokenize(text).map((token) => ({
    surface: token.surface_form,
    reading: token.reading && token.reading !== '*' ? token.reading : undefined,
  }));
}
