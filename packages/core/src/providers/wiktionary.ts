import { decodeEntities, stripTags } from '../subtitles/clean';
import { baseLanguage } from '../text/language';
import { firstWord } from '../text/segment';
import { ProviderError, type Dictionary, type DictionaryEntry } from './types';

const ENDPOINT = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const MAX_SENSES = 4;
const MAX_EXAMPLES = 1;

/** Wiktionary files some languages under another code (Croatian, Serbian and Bosnian are all "sh"). */
const WIKTIONARY_CODES: Record<string, string> = { hr: 'sh', sr: 'sh', bs: 'sh' };

interface RawDefinition {
  definition?: string;
  examples?: string[];
}

interface RawSection {
  partOfSpeech?: string;
  language?: string;
  definitions?: RawDefinition[];
}

function htmlToText(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

/** Extracts the entries for `lang` from an English Wiktionary REST "definition" response for `page`. */
export function parseWiktionaryResponse(data: unknown, lang: string, page = ''): DictionaryEntry[] {
  const base = baseLanguage(lang);
  const sections = (data as Record<string, unknown> | null)?.[WIKTIONARY_CODES[base] ?? base];
  if (!Array.isArray(sections)) return [];
  const source = {
    name: 'Wiktionary · CC BY-SA',
    url: page ? `https://en.wiktionary.org/wiki/${encodeURIComponent(page)}` : undefined,
  };

  const entries: DictionaryEntry[] = [];
  for (const section of sections as RawSection[]) {
    const senses = (section.definitions ?? [])
      .map((d) => ({
        definition: htmlToText(d.definition ?? ''),
        examples: (d.examples ?? []).map(htmlToText).filter(Boolean).slice(0, MAX_EXAMPLES),
      }))
      // "{{rfdef}}" is Wiktionary's request-for-definition placeholder, not a meaning.
      .filter((s) => s.definition && !s.definition.includes('{{rfdef}}'))
      .slice(0, MAX_SENSES);
    if (senses.length === 0) continue;
    entries.push({
      language: section.language ?? lang,
      partOfSpeech: section.partOfSpeech ?? '',
      senses,
      source,
    });
  }
  return entries;
}

/**
 * Free, key-less dictionary backed by English Wiktionary. Definitions are in
 * English regardless of the word's language.
 */
export class WiktionaryDictionary implements Dictionary {
  readonly name = 'Wiktionary';

  async lookup(word: string, lang: string, signal?: AbortSignal): Promise<DictionaryEntry[]> {
    // A Japanese click is a whole phrase (映画を); Wiktionary only has its first word (映画).
    const candidates = [...new Set([word, word.toLocaleLowerCase(), firstWord(word, lang)])];

    for (const candidate of candidates) {
      const response = await fetch(ENDPOINT + encodeURIComponent(candidate), {
        headers: { 'Api-User-Agent': 'Glossa/0.1 (open-source language-learning subtitles)' },
        signal,
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new ProviderError(`Wiktionary request failed (${response.status})`, response.status);
      }
      const entries = parseWiktionaryResponse(await response.json(), lang, candidate);
      if (entries.length > 0) return entries;
    }
    return [];
  }
}
