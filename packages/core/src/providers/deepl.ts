import { baseLanguage } from '../text/language';
import { ProviderError, type TranslationRequest, type Translator } from './types';

/** DeepL needs a regional variant for a few target languages. */
export function deeplTargetLanguage(tag: string): string {
  const lower = tag.toLowerCase();
  const base = baseLanguage(tag);
  if (base === 'en') return lower === 'en-gb' ? 'EN-GB' : 'EN-US';
  if (base === 'pt') return lower === 'pt-pt' ? 'PT-PT' : 'PT-BR';
  if (base === 'zh') return /hant|tw|hk/.test(lower) ? 'ZH-HANT' : 'ZH-HANS';
  return base.toUpperCase();
}

export class DeepLTranslator implements Translator {
  readonly name = 'DeepL';

  constructor(private readonly apiKey: string) {}

  private get endpoint(): string {
    // Free-plan keys end in ":fx" and use a separate host.
    return this.apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
  }

  async translate({ text, from, to, sentence, context }: TranslationRequest, signal?: AbortSignal): Promise<string> {
    // DeepL uses `context` to pick meanings and pronouns, without translating it.
    const contextText = [...(context?.before ?? []), sentence ?? '', ...(context?.after ?? [])].filter(Boolean).join('\n');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        target_lang: deeplTargetLanguage(to),
        ...(from ? { source_lang: baseLanguage(from).toUpperCase() } : {}),
        ...(contextText ? { context: contextText } : {}),
      }),
      signal,
    });
    if (!response.ok) {
      throw new ProviderError(`DeepL request failed (${response.status})`, response.status);
    }
    const data = (await response.json()) as { translations?: { text: string }[] };
    const translated = data.translations?.[0]?.text;
    if (typeof translated !== 'string') throw new ProviderError('DeepL returned no translation');
    return translated;
  }
}
