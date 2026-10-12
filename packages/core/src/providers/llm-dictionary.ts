import { languageName } from '../text/language';
import { stripThinking } from './llm';
import { buildDictionaryPrompt, DICTIONARY_SYSTEM_PROMPT } from './prompts';
import type { ChatModel, Dictionary, DictionaryEntry, DictionarySense } from './types';

const MAX_SENSES = 3;
/** Definitions should be the same on every lookup. */
const DICTIONARY_TEMPERATURE = 0.2;

/**
 * Parses reply lines of the form "noun | a four-legged pet" into entries grouped by part of speech.
 * Lines without a "|" (a refusal, a lead-in) are ignored, except ones that start with "form of".
 */
export function parseDictionaryReply(reply: string, lang: string, sourceName: string): DictionaryEntry[] {
  const byPartOfSpeech = new Map<string, DictionarySense[]>();
  let count = 0;
  for (const line of stripThinking(reply).split('\n')) {
    if (count >= MAX_SENSES) break;
    const text = line.replace(/^[\s•*\-\d.)]+/, '').replace(/\*\*/g, '');
    // Small models often drop "part of speech |" on inflected forms and just write "form of …".
    const [pos = '', ...rest] = /^form of /i.test(text) ? ['', text] : text.split('|');
    const definition = rest.join('|').trim();
    if (!definition) continue;
    const partOfSpeech = pos.trim().toLowerCase();
    byPartOfSpeech.set(partOfSpeech, [...(byPartOfSpeech.get(partOfSpeech) ?? []), { definition, examples: [] }]);
    count++;
  }
  return [...byPartOfSpeech].map(([partOfSpeech, senses]) => ({
    language: languageName(lang),
    partOfSpeech,
    senses,
    source: { name: sourceName },
  }));
}

/**
 * A dictionary written by the learner's own AI model: covers languages and inflected forms the
 * free dictionaries lack, and defines in the learner's language. Use it as a last resort.
 */
export class LlmDictionary implements Dictionary {
  constructor(
    private readonly model: ChatModel,
    /** Language to write definitions in. */
    private readonly definitionLanguage: string,
  ) {}

  get name(): string {
    return `AI · ${this.model.name}`;
  }

  async lookup(word: string, lang: string, signal?: AbortSignal): Promise<DictionaryEntry[]> {
    const reply = await this.model.complete(
      DICTIONARY_SYSTEM_PROMPT,
      buildDictionaryPrompt(word, lang, this.definitionLanguage),
      { signal, languages: { input: [lang], output: this.definitionLanguage }, temperature: DICTIONARY_TEMPERATURE },
    );
    return parseDictionaryReply(reply, lang, this.name);
  }
}
