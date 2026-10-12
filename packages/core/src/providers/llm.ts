import {
  TRANSLATOR_SYSTEM_PROMPT,
  tutorSystemPrompt,
  buildExplainPrompt,
  buildTranslatePrompt,
} from './prompts';
import type { ChatModel, ExplainRequest, Explainer, TranslationRequest, Translator } from './types';

/**
 * Removes a reasoning block (`<think>…</think>`) from a reply. Some models and servers include one
 * even when asked not to think.
 */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** A reply's lead-in like "Translation:" or "Here's the translation:", which small models sometimes add. */
const LEAD_IN = /^(?:here(?:'s| is) (?:the|my|a) (?:\w+ )?translation|translation)\b[^\n:]*:\s*/i;
/** Quotes wrapped around the whole reply. */
const WRAPPING_QUOTES = /^(["“「『'])([\s\S]*)(["”」』'])$/;

/** Removes what a model adds around a translation despite being asked not to. */
export function cleanTranslation(text: string): string {
  let result = stripThinking(text).replace(LEAD_IN, '').trim();
  const quoted = WRAPPING_QUOTES.exec(result);
  if (quoted && !/["“”「」『』]/.test(quoted[2]!)) result = quoted[2]!.trim();
  return result;
}

/** Translations should stick to the source; explanations can be a little freer. */
const TRANSLATION_TEMPERATURE = 0.2;
const EXPLANATION_TEMPERATURE = 0.4;

export class LlmExplainer implements Explainer {
  constructor(private readonly model: ChatModel) {}

  get name(): string {
    return this.model.name;
  }

  async explain(request: ExplainRequest, signal?: AbortSignal): Promise<string> {
    const reply = await this.model.complete(tutorSystemPrompt(request.explainIn), buildExplainPrompt(request), {
      signal,
      languages: { input: [request.lang], output: request.explainIn },
      temperature: EXPLANATION_TEMPERATURE,
    });
    return stripThinking(reply);
  }
}

export class LlmTranslator implements Translator {
  constructor(private readonly model: ChatModel) {}

  get name(): string {
    return this.model.name;
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<string> {
    const reply = await this.model.complete(TRANSLATOR_SYSTEM_PROMPT, buildTranslatePrompt(request), {
      signal,
      languages: { input: [request.from], output: request.to },
      temperature: TRANSLATION_TEMPERATURE,
    });
    return cleanTranslation(reply);
  }
}
