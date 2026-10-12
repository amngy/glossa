import { baseLanguage } from '../text/language';
import { ProviderError, type TranslationRequest, type Translator } from './types';

export interface LibreTranslateConfig {
  /** Server root, e.g. "http://localhost:5000" for a self-hosted instance. */
  url: string;
  apiKey?: string;
}

/** Self-hostable, open-source machine translation: https://github.com/LibreTranslate/LibreTranslate */
export class LibreTranslateTranslator implements Translator {
  readonly name = 'LibreTranslate';

  constructor(private readonly config: LibreTranslateConfig) {}

  async translate({ text, from, to }: TranslationRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.config.url.replace(/\/+$/, '')}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: from ? baseLanguage(from) : 'auto',
        target: baseLanguage(to),
        format: 'text',
        ...(this.config.apiKey ? { api_key: this.config.apiKey } : {}),
      }),
      signal,
    });
    const data = (await response.json().catch(() => null)) as
      | { translatedText?: string; error?: string }
      | null;
    if (!response.ok || typeof data?.translatedText !== 'string') {
      throw new ProviderError(
        `LibreTranslate: ${data?.error ?? `request failed (${response.status})`}`,
        response.status,
      );
    }
    return data.translatedText;
  }
}
