import { baseLanguage } from '../text/language';
import { ProviderError, type TranslationRequest, type Translator } from './types';

/**
 * Wrapper for the on-device Translator API built into Chrome (138+) and other
 * Chromium browsers: free, private, works offline once a language pack is
 * downloaded. https://developer.chrome.com/docs/ai/translator-api
 *
 * Only available in window contexts (content scripts, extension pages), not
 * in service workers.
 */

export type BrowserTranslatorAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface NativeTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface NativeTranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslatorAvailability>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<NativeTranslator>;
}

/** How long to wait for a missing language pack to download before giving up. */
const DOWNLOAD_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function nativeApi(): NativeTranslatorStatic | undefined {
  return (globalThis as { Translator?: NativeTranslatorStatic }).Translator;
}

/** The Translator API expects simple tags; keep the script subtag only for Traditional Chinese. */
function apiLanguage(tag: string): string {
  const base = baseLanguage(tag);
  if (base === 'zh' && /hant|tw|hk/i.test(tag)) return 'zh-Hant';
  return base;
}

export function isBrowserTranslatorSupported(): boolean {
  return nativeApi() !== undefined;
}

export class BrowserTranslator implements Translator {
  readonly name = 'Built-in browser translator';
  private readonly instances = new Map<string, Promise<NativeTranslator>>();

  async availability(from: string, to: string): Promise<BrowserTranslatorAvailability> {
    const api = nativeApi();
    if (!api) return 'unavailable';
    try {
      return await api.availability({ sourceLanguage: apiLanguage(from), targetLanguage: apiLanguage(to) });
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Creating a translator for a pair whose language pack is not downloaded yet
   * requires a recent user gesture, so call this from a click handler the
   * first time.
   */
  async translate({ text, from, to }: TranslationRequest): Promise<string> {
    const api = nativeApi();
    if (!api) throw new ProviderError('This browser has no built-in translator.');

    const sourceLanguage = apiLanguage(from);
    const targetLanguage = apiLanguage(to);
    if (sourceLanguage === targetLanguage) return text;

    const key = `${sourceLanguage}>${targetLanguage}`;
    let instance = this.instances.get(key);
    if (!instance) {
      instance = this.create(api, sourceLanguage, targetLanguage);
      this.instances.set(key, instance);
      instance.catch(() => this.instances.delete(key));
    }
    return (await instance).translate(text);
  }

  private async create(api: NativeTranslatorStatic, sourceLanguage: string, targetLanguage: string): Promise<NativeTranslator> {
    const availability = await api.availability({ sourceLanguage, targetLanguage });
    if (availability === 'unavailable') {
      throw new ProviderError('The built-in translator doesn’t support this language pair.');
    }
    const created = api.create({ sourceLanguage, targetLanguage });
    if (availability === 'available') return created;
    return withTimeout(
      created,
      DOWNLOAD_TIMEOUT_MS,
      'The built-in translator couldn’t download this language pack. Try again later or choose another translator in Glossa’s settings.',
    );
  }
}
