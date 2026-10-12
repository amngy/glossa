import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserLanguageModel,
  buildExplainPrompt,
  buildTranslatePrompt,
  LlmTranslator,
  stripThinking,
  subtitleContext,
  type ChatModel,
} from '../src';

const context = { before: ['¿Viste a Pedro?', 'Sí, estaba en el banco.'], after: ['¿Sentado o sacando dinero?'] };

describe('prompts with nearby lines', () => {
  it('frames the explained line with the lines around it', () => {
    const prompt = buildExplainPrompt({ kind: 'word', word: 'banco', sentence: 'Lo vi en el banco.', lang: 'es', explainIn: 'en', context });
    const lines = prompt.split('\n');
    expect(lines.indexOf('Lines before:')).toBeLessThan(lines.indexOf('Subtitle line: "Lo vi en el banco."'));
    expect(lines.indexOf('Lines after:')).toBeGreaterThan(lines.indexOf('Subtitle line: "Lo vi en el banco."'));
    expect(prompt).toContain('"¿Sentado o sacando dinero?"');
    expect(prompt).toContain('only there so you understand the situation');
  });

  it('asks for the answer language in that language too', () => {
    const request = { kind: 'sentence', sentence: 'Hola.', lang: 'es' } as const;
    expect(buildExplainPrompt({ ...request, explainIn: 'de' }).endsWith('Write the explanation in German. Antworte auf Deutsch.')).toBe(true);
    expect(buildExplainPrompt({ ...request, explainIn: 'en' }).endsWith('Write the explanation in English.')).toBe(true);
  });

  it('leaves context out when there is none', () => {
    const prompt = buildExplainPrompt({ kind: 'sentence', sentence: 'Hola.', lang: 'es', explainIn: 'en' });
    expect(prompt).not.toContain('Lines before');
    expect(prompt).not.toContain('situation');
  });

  it('puts the line to translate last, after the context', () => {
    const prompt = buildTranslatePrompt({ text: 'Lo vi en el banco.', from: 'es', to: 'de', context });
    expect(
      prompt.endsWith(
        'Translate only this Spanish subtitle line into German, even if its sentence goes on in the later lines:\nLo vi en el banco.',
      ),
    ).toBe(true);
    expect(prompt).toContain('Earlier lines, for context only:\n"¿Viste a Pedro?"');
  });

  it('asks for a word in the sense it has in its line', () => {
    const prompt = buildTranslatePrompt({ text: 'banco', from: 'es', to: 'en', sentence: 'Lo vi en el banco.' });
    expect(prompt).toContain('Subtitle line: "Lo vi en el banco."');
    expect(prompt).toContain('Translate the Spanish word "banco" into English, with the meaning it has in this line and situation.');
    expect(prompt).toContain('Reply with a short English translation of "banco" only');
  });

  it('removes a reasoning block from the reply', async () => {
    const complete = vi.fn<ChatModel['complete']>().mockResolvedValue('<think>\n\n</think>\n\nBank');
    expect(await new LlmTranslator({ name: 'fake', complete }).translate({ text: 'banco', from: 'es', to: 'en' })).toBe('Bank');
    expect(stripThinking('<think>hmm</think> Hallo <think>x</think>')).toBe('Hallo');
  });

  it('tells the model which languages it reads and writes', async () => {
    const complete = vi.fn<ChatModel['complete']>().mockResolvedValue('Bank');
    await new LlmTranslator({ name: 'fake', complete }).translate({ text: 'banco', from: 'es-MX', to: 'en' });
    expect(complete.mock.calls[0]![2]?.languages).toEqual({ input: ['es-MX'], output: 'en' });
  });
});

describe('BrowserLanguageModel', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeApi(supported: string[]) {
    const prompts: string[] = [];
    const created: unknown[] = [];
    const session = {
      prompt: vi.fn(async (input: string) => {
        prompts.push(input);
        return ' answer ';
      }),
      clone: vi.fn(async () => session),
      destroy: vi.fn(),
    };
    const api = {
      availability: vi.fn(async (options: { expectedInputs: { languages: string[] }[]; expectedOutputs: { languages: string[] }[] }) =>
        [...options.expectedInputs[0]!.languages, ...options.expectedOutputs[0]!.languages].every((l) => supported.includes(l))
          ? 'available'
          : 'unavailable',
      ),
      create: vi.fn(async (options: unknown) => {
        created.push(options);
        return session;
      }),
    };
    vi.stubGlobal('LanguageModel', api);
    return { api, session, prompts, created };
  }

  it('runs each request in a clone of one session per system prompt', async () => {
    const { api, session, prompts } = fakeApi(['en', 'es', 'de']);
    const model = new BrowserLanguageModel();
    const languages = { input: ['es'], output: 'de' };
    expect(await model.complete('system', 'first', { languages })).toBe('answer');
    expect(await model.complete('system', 'second', { languages })).toBe('answer');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(session.clone).toHaveBeenCalledTimes(2);
    expect(session.destroy).toHaveBeenCalledTimes(2);
    expect(prompts).toEqual(['first', 'second']);
  });

  it('still reads a subtitle language the model does not list', async () => {
    const { created } = fakeApi(['en', 'de']);
    await new BrowserLanguageModel().complete('system', 'hi', { languages: { input: ['hu'], output: 'de' } });
    expect(created[0]).toMatchObject({ expectedInputs: [{ languages: ['en'] }], expectedOutputs: [{ languages: ['de'] }] });
  });

  it('explains when it cannot write the language', async () => {
    fakeApi(['en']);
    await expect(new BrowserLanguageModel().complete('system', 'hi', { languages: { input: ['es'], output: 'hu' } })).rejects.toThrow(
      'can’t write Hungarian',
    );
  });
});

describe('subtitleContext', () => {
  const cue = (start: number, text: string) => ({ start, end: start + 2, text });
  const cues = [cue(0, 'uno'), cue(3, 'dos'), cue(6, 'tres'), cue(9, 'cuatro'), cue(12, 'cinco'), cue(15, 'seis'), cue(18, 'siete')];

  it('takes up to three lines before and two after', () => {
    expect(subtitleContext(cues, 4)).toEqual({ before: ['dos', 'tres', 'cuatro'], after: ['seis', 'siete'] });
    expect(subtitleContext(cues, 0)).toEqual({ before: [], after: ['dos', 'tres'] });
  });

  it('stops at a long pause', () => {
    const scenes = [cue(0, 'old scene'), cue(40, 'hola'), cue(43, 'adiós'), cue(90, 'next scene')];
    expect(subtitleContext(scenes, 1)).toEqual({ before: [], after: ['adiós'] });
  });

  it('skips repeated lines and joins multi-line cues', () => {
    const repeated = [cue(0, 'hola'), cue(2, 'hola'), cue(4, 'qué\ntal'), cue(6, 'hola')];
    expect(subtitleContext(repeated, 3)).toEqual({ before: ['qué tal'], after: [] });
  });

  it('keeps the closest lines when there is little room', () => {
    expect(subtitleContext(cues, 3, { maxChars: 10 })).toEqual({ before: ['tres'], after: ['cinco'] });
  });

  it('returns nothing for a missing line', () => {
    expect(subtitleContext(cues, 99)).toEqual({ before: [], after: [] });
  });
});
