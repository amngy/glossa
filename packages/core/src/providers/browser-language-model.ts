import { baseLanguage, languageName } from '../text/language';
import { ProviderError, type ChatLanguages, type ChatModel, type ChatOptions } from './types';

/**
 * Wrapper for the Prompt API built into Chrome (Gemini Nano) and other browsers: free, private,
 * and runs on the device once the browser has downloaded its model.
 * https://developer.chrome.com/docs/ai/prompt-api
 *
 * In extensions it works in pages and in the background service worker. Downloading the model
 * needs a user gesture, so it has to start from a click (see `downloadBrowserLanguageModel`).
 */

export type BrowserModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageExpectation {
  type: 'text';
  languages: string[];
}

interface SessionOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  expectedInputs?: LanguageExpectation[];
  expectedOutputs?: LanguageExpectation[];
  monitor?: (monitor: EventTarget) => void;
  signal?: AbortSignal;
}

interface NativeSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  clone(options?: { signal?: AbortSignal }): Promise<NativeSession>;
  destroy(): void;
}

interface NativeLanguageModel {
  availability(options?: SessionOptions): Promise<BrowserModelAvailability>;
  create(options?: SessionOptions): Promise<NativeSession>;
}

function nativeApi(): NativeLanguageModel | undefined {
  return (globalThis as { LanguageModel?: NativeLanguageModel }).LanguageModel;
}

export function isBrowserLanguageModelSupported(): boolean {
  return nativeApi() !== undefined;
}

/** What a session reads and writes. Glossa's instructions are in English. */
function expectations(input: string[], output: string): Pick<SessionOptions, 'expectedInputs' | 'expectedOutputs'> {
  const inputs = [...new Set(['en', ...input.map(baseLanguage)])];
  return {
    expectedInputs: [{ type: 'text', languages: inputs }],
    expectedOutputs: [{ type: 'text', languages: [baseLanguage(output)] }],
  };
}

async function availabilityOf(api: NativeLanguageModel, options: SessionOptions): Promise<BrowserModelAvailability> {
  try {
    return await api.availability(options);
  } catch {
    return 'unavailable';
  }
}

/**
 * Whether the browser's model can write `languages.output`. The subtitle language doesn't have to be
 * supported: the model then still reads it, just less reliably.
 */
export async function browserLanguageModelAvailability(languages: ChatLanguages): Promise<BrowserModelAvailability> {
  const api = nativeApi();
  if (!api) return 'unavailable';
  return availabilityOf(api, expectations([], languages.output));
}

/** Downloads the browser's model. Call from a click handler: browsers require a user gesture. */
export async function downloadBrowserLanguageModel(
  languages: ChatLanguages,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const api = nativeApi();
  if (!api) throw new ProviderError('This browser has no built-in AI model.');
  const session = await api.create({
    ...expectations([], languages.output),
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => onProgress?.((event as ProgressEvent).loaded));
    },
  });
  session.destroy();
}

export class BrowserLanguageModel implements ChatModel {
  readonly name = 'Built-in browser model';
  /** One session per system prompt and languages; each request runs in a clone of it. */
  private readonly sessions = new Map<string, Promise<NativeSession>>();

  async complete(system: string, prompt: string, { signal, languages }: ChatOptions = {}): Promise<string> {
    const api = nativeApi();
    if (!api) throw new ProviderError('This browser has no built-in AI model.');

    const input = languages?.input ?? [];
    const output = languages?.output ?? 'en';
    const key = JSON.stringify([system, input.map(baseLanguage), baseLanguage(output)]);
    let base = this.sessions.get(key);
    if (!base) {
      base = this.createSession(api, system, input, output);
      this.sessions.set(key, base);
      base.catch(() => this.sessions.delete(key));
    }

    const session = await (await base).clone({ signal });
    try {
      const text = (await session.prompt(prompt, { signal })).trim();
      if (!text) throw new ProviderError('The built-in model returned an empty response.');
      return text;
    } finally {
      session.destroy();
    }
  }

  private async createSession(api: NativeLanguageModel, system: string, input: string[], output: string): Promise<NativeSession> {
    // Prefer declaring the subtitle language; if the model doesn't list it, read it anyway.
    let options = expectations(input, output);
    let availability = await availabilityOf(api, options);
    if (availability === 'unavailable') {
      options = expectations([], output);
      availability = await availabilityOf(api, options);
    }
    switch (availability) {
      case 'unavailable':
        throw new ProviderError(
          `The browser’s built-in model can’t write ${languageName(output)}, or this device doesn’t meet its requirements.`,
        );
      case 'downloadable':
        throw new ProviderError('Download the browser’s built-in model in Glossa’s settings first.');
      case 'downloading':
        throw new ProviderError('The browser is still downloading its built-in model. Try again in a few minutes.');
      case 'available':
        return api.create({ ...options, initialPrompts: [{ role: 'system', content: system }] });
    }
  }
}
