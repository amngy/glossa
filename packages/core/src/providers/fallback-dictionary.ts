import type { Dictionary, DictionaryEntry } from './types';

/**
 * Asks each dictionary in turn and returns the first answer that has entries, so one source's gaps
 * (a missing language or inflected form) or outage doesn't leave the learner without a definition.
 */
export class FallbackDictionary implements Dictionary {
  readonly name: string;

  constructor(private readonly sources: readonly Dictionary[]) {
    this.name = sources.map((source) => source.name).join(' → ');
  }

  async lookup(word: string, lang: string, signal?: AbortSignal): Promise<DictionaryEntry[]> {
    let failure: unknown;
    let answered = false;
    for (const source of this.sources) {
      try {
        const entries = await source.lookup(word, lang, signal);
        answered = true;
        if (entries.length > 0) return entries;
      } catch (error) {
        if (signal?.aborted) throw error;
        failure ??= error;
      }
    }
    // A source that was reachable and had nothing means "no entry", not "unavailable".
    if (!answered && failure) throw failure;
    return [];
  }
}
