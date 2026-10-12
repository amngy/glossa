import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildExplainPrompt,
  cleanTranslation,
  deeplTargetLanguage,
  parseDictionaryReply,
  pickVoice,
  LruCache,
  normalizeOpenAIBaseUrl,
  OpenAICompatibleChatModel,
  parseWiktionaryResponse,
  WiktionaryDictionary,
} from '../src';

describe('parseWiktionaryResponse', () => {
  const response = {
    en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'house' }] }],
    es: [
      {
        partOfSpeech: 'Noun',
        language: 'Spanish',
        definitions: [
          {
            definition: '<a rel="mw:WikiLink" href="/wiki/house">house</a>, <a href="/wiki/home">home</a>',
            examples: ['Mi <b>casa</b> es tu <b>casa</b>.'],
          },
          { definition: '<span class="mw-empty-elt"></span>' },
        ],
      },
      {
        partOfSpeech: 'Verb',
        language: 'Spanish',
        definitions: [{ definition: 'inflection of <i>casar</i>' }],
      },
    ],
  };

  const source = { name: 'Wiktionary · CC BY-SA', url: 'https://en.wiktionary.org/wiki/casa' };

  it('returns plain-text entries for the requested language only', () => {
    expect(parseWiktionaryResponse(response, 'es-MX', 'casa')).toEqual([
      {
        language: 'Spanish',
        partOfSpeech: 'Noun',
        senses: [{ definition: 'house, home', examples: ['Mi casa es tu casa.'] }],
        source,
      },
      {
        language: 'Spanish',
        partOfSpeech: 'Verb',
        senses: [{ definition: 'inflection of casar', examples: [] }],
        source,
      },
    ]);
  });

  it('drops the request-for-definition placeholder and entries left empty by it', () => {
    const placeholder =
      'This term needs a translation to English. Please help out and add a translation, then remove the text {{rfdef}}.';
    const data = {
      ja: [
        { partOfSpeech: 'Noun', language: 'Japanese', definitions: [{ definition: 'spirit' }, { definition: placeholder }] },
        { partOfSpeech: 'Verb', language: 'Japanese', definitions: [{ definition: placeholder }] },
      ],
    };
    expect(parseWiktionaryResponse(data, 'ja')).toEqual([
      {
        language: 'Japanese',
        partOfSpeech: 'Noun',
        senses: [{ definition: 'spirit', examples: [] }],
        source: { name: 'Wiktionary · CC BY-SA' },
      },
    ]);
  });

  it('finds Croatian and Serbian under Wiktionary’s Serbo-Croatian code', () => {
    const sh = { sh: [{ partOfSpeech: 'Noun', language: 'Serbo-Croatian', definitions: [{ definition: 'house' }] }] };
    expect(parseWiktionaryResponse(sh, 'hr', 'kuća')[0]?.senses[0]?.definition).toBe('house');
    expect(parseWiktionaryResponse(sh, 'sr-Latn')).toHaveLength(1);
  });

  it('returns nothing for a language without entries', () => {
    expect(parseWiktionaryResponse(response, 'de')).toEqual([]);
    expect(parseWiktionaryResponse(null, 'es')).toEqual([]);
  });
});

describe('WiktionaryDictionary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to a Japanese phrase's first word", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith(encodeURIComponent('映画'))
        ? new Response(JSON.stringify({ ja: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'movie' }] }] }))
        : new Response('', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetch);
    const entries = await new WiktionaryDictionary().lookup('映画を', 'ja');
    expect(entries[0]?.senses[0]?.definition).toBe('movie');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('parseDictionaryReply', () => {
  it('groups lines by part of speech and ignores lines without a definition', () => {
    const reply = '<think>hm</think>Sure!\n1. **noun** | form of kutya: dog\n- noun | pet\nverb | to walk a dog';
    const entries = parseDictionaryReply(reply, 'hu', 'AI · test');
    expect(entries.map((e) => [e.partOfSpeech, e.senses.map((s) => s.definition)])).toEqual([
      ['noun', ['form of kutya: dog', 'pet']],
      ['verb', ['to walk a dog']],
    ]);
    expect(entries[0]?.language).toBe('Hungarian');
    expect(entries[0]?.source.name).toBe('AI · test');
  });

  it('keeps an inflected form that has no part of speech', () => {
    const entries = parseDictionaryReply('Form of szeretni: to love', 'hu', 'AI');
    expect(entries).toMatchObject([{ partOfSpeech: '', senses: [{ definition: 'Form of szeretni: to love' }] }]);
  });

  it('returns nothing for "unknown"', () => {
    expect(parseDictionaryReply('unknown', 'hu', 'AI')).toEqual([]);
  });
});

describe('pickVoice', () => {
  const voice = (name: string, lang: string, localService = true, isDefault = false) => ({
    name,
    lang,
    localService,
    default: isDefault,
  });
  const voices = [
    voice('Microsoft David', 'en-US', true, true),
    voice('Microsoft Maria', 'pt-PT'),
    voice('Google português do Brasil', 'pt-BR', false),
    voice('Microsoft Tamas Online (Natural)', 'hu-HU', false),
  ];

  it('never falls back to an unrelated voice', () => {
    expect(pickVoice(voices, 'ja')).toBeUndefined();
    expect(pickVoice([voice('Microsoft David', 'en-US', true, true)], 'hu')).toBeUndefined();
  });

  it('never picks a voice that sends the text to a remote service', () => {
    expect(pickVoice(voices, 'hu')).toBeUndefined();
    expect(pickVoice(voices, 'pt-BR')?.name).toBe('Microsoft Maria');
  });

  it('matches the base language and prefers the exact region', () => {
    const local = [voice('Microsoft Maria', 'pt-PT'), voice('Microsoft Francisca', 'pt-BR')];
    expect(pickVoice(local, 'pt-BR')?.name).toBe('Microsoft Francisca');
    expect(pickVoice(local, 'pt')).toBeDefined();
    expect(pickVoice([voice('Android hu', 'hu_HU')], 'hu-HU')).toBeDefined();
  });
});

describe('deeplTargetLanguage', () => {
  it('maps tags to the variants DeepL requires', () => {
    expect(deeplTargetLanguage('en')).toBe('EN-US');
    expect(deeplTargetLanguage('en-GB')).toBe('EN-GB');
    expect(deeplTargetLanguage('pt')).toBe('PT-BR');
    expect(deeplTargetLanguage('zh-TW')).toBe('ZH-HANT');
    expect(deeplTargetLanguage('hu')).toBe('HU');
  });
});

describe('buildExplainPrompt', () => {
  it('names both languages and includes the context line', () => {
    const prompt = buildExplainPrompt({
      kind: 'word',
      word: 'está',
      sentence: '¿Dónde está la biblioteca?',
      lang: 'es',
      explainIn: 'de',
    });
    expect(prompt).toContain('Video language: Spanish');
    expect(prompt).toContain('In German, explain:');
    expect(prompt).toContain('"¿Dónde está la biblioteca?"');
  });
});

describe('normalizeOpenAIBaseUrl', () => {
  it('adds /v1 to a bare server address', () => {
    expect(normalizeOpenAIBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1');
    expect(normalizeOpenAIBaseUrl(' http://localhost:1234 ')).toBe('http://localhost:1234/v1');
  });

  it('keeps URLs that already have a path', () => {
    expect(normalizeOpenAIBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
    expect(normalizeOpenAIBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1');
  });
});

describe('cleanTranslation', () => {
  it('removes lead-ins and quotes a model adds', () => {
    expect(cleanTranslation("Here's the translation:\n\nThank you!")).toBe('Thank you!');
    expect(cleanTranslation('Translation: "No way…"')).toBe('No way…');
    expect(cleanTranslation('「了解」')).toBe('了解');
  });

  it('keeps quotes that are part of the line', () => {
    expect(cleanTranslation('"Run," he said. "Now."')).toBe('"Run," he said. "Now."');
    expect(cleanTranslation('Translating is hard.')).toBe('Translating is hard.');
  });
});

describe('OpenAICompatibleChatModel', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

  it("uses Ollama's own API, with a small context and thinking off", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ message: { content: 'Hi' } }));
    vi.stubGlobal('fetch', fetch);
    const model = new OpenAICompatibleChatModel({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' });
    expect(await model.complete('system', 'prompt', { temperature: 0.2 })).toBe('Hi');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body)).toMatchObject({ think: false, options: { num_ctx: 4096, temperature: 0.2 } });
  });

  it('retries without temperature when a server rejects it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply({ error: { message: "Unsupported value: 'temperature'" } }, 400))
      .mockResolvedValue(reply({ choices: [{ message: { content: 'Hola' } }] }));
    vi.stubGlobal('fetch', fetch);
    const model = new OpenAICompatibleChatModel({ baseUrl: 'https://api.example.com/v1', model: 'm' });
    expect(await model.complete('system', 'prompt', { temperature: 0.2 })).toBe('Hola');
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example.com/v1/chat/completions');
    expect(JSON.parse(fetch.mock.calls[1]![1].body).temperature).toBeUndefined();
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});
