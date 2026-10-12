/**
 * Subtitle lines around the one being translated or explained. AI models use them to work out who
 * "he" is, what "it" refers to, or which meaning of an ambiguous word fits. They aren't translated.
 */
export interface SubtitleContext {
  /** Lines shown just before, oldest first. */
  before: string[];
  /** Lines shown just after. */
  after: string[];
}

export interface TranslationRequest {
  text: string;
  /** BCP 47 tag of the source text. */
  from: string;
  /** BCP 47 tag to translate into. */
  to: string;
  /** When `text` is a single word: the subtitle line it appears in, so its meaning there is used. */
  sentence?: string;
  /** Nearby lines, for translators that can use context (AI models, DeepL). */
  context?: SubtitleContext;
}

export interface Translator {
  readonly name: string;
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<string>;
}

export interface DictionarySense {
  definition: string;
  examples: string[];
}

export interface DictionaryEntry {
  /** Language name as reported by the dictionary, e.g. "Spanish". */
  language: string;
  partOfSpeech: string;
  senses: DictionarySense[];
}

export interface Dictionary {
  readonly name: string;
  lookup(word: string, lang: string, signal?: AbortSignal): Promise<DictionaryEntry[]>;
}

export type ExplainRequest =
  | {
      kind: 'word';
      word: string;
      /** The subtitle line the word appeared in. */
      sentence: string;
      /** Language of the word and sentence. */
      lang: string;
      /** Language to write the explanation in. */
      explainIn: string;
      context?: SubtitleContext;
    }
  | {
      kind: 'sentence';
      sentence: string;
      lang: string;
      explainIn: string;
      context?: SubtitleContext;
    };

export interface Explainer {
  readonly name: string;
  explain(request: ExplainRequest, signal?: AbortSignal): Promise<string>;
}

/** Languages a request reads and writes, for models that support only some languages. */
export interface ChatLanguages {
  input: string[];
  output: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  languages?: ChatLanguages;
  /** Sampling temperature, for backends that take one. Low values keep translations faithful. */
  temperature?: number;
}

/** Minimal text-in/text-out interface implemented by each LLM backend. */
export interface ChatModel {
  readonly name: string;
  complete(system: string, prompt: string, options?: ChatOptions): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
