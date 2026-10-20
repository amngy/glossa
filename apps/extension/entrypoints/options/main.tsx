import '@/assets/page.css';
import './style.css';
import { browser } from '#imports';
import {
  BrowserTranslator,
  DEFAULT_ANTHROPIC_MODEL,
  isBrowserTranslatorSupported,
  languageName,
  normalizeOpenAIBaseUrl,
  toAnkiTsv,
  toCsv,
  type SavedWord,
} from '@glossa/core';
import type { ComponentChildren } from 'preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { OPENAI_PRESETS } from '@/lib/ai-presets';
import { languageOptions } from '@/lib/languages';
import { BuiltInModelSetup, OnDeviceModelSetup } from './ai-models';
import { ChromeSpeechSetup, CompanionSetup, OptionalPacks, usePackInstalled } from './packs';
import { JAPANESE_READINGS } from '@/lib/packs';
import { sendMessage } from '@/lib/messages';
import { requestOrigins, requiredOrigins } from '@/lib/permissions';
import {
  getSecrets,
  getSettings,
  MAX_SUBTITLE_POSITION,
  updateSecrets,
  updateSettings,
  watchSettings,
  type AiProvider,
  type Secrets,
  type Settings,
  type TranslatorChoice,
} from '@/lib/settings';
import { getVideoSites, removeVideoSite, watchVideoSites } from '@/lib/video-sites';
import { clearKnown, clearVocab, getKnown, getVocab, removeWord, watchKnown, watchVocab } from '@/lib/vocab-store';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

// The ids double as URL hashes: the popup links to #packs and #words.
const PAGES = [
  { id: 'general', label: 'General' },
  { id: 'translation', label: 'Translation' },
  { id: 'ai', label: 'AI explanations' },
  { id: 'packs', label: 'Optional packs' },
  { id: 'sites', label: 'Other sites' },
  { id: 'words', label: 'Saved words' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

const pageFromHash = (): PageId => PAGES.find((page) => `#${page.id}` === location.hash)?.id ?? 'general';

const SHORTCUTS = [
  ['A', 'Previous line'],
  ['S', 'Replay line'],
  ['D', 'Next line'],
  ['Q', 'Show / blur / hide translation'],
  ['Esc', 'Close the word card'],
];

function Section({ title, intro, children }: { title: string; intro?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="section">
      <h2>{title}</h2>
      {intro && <p class="muted section-intro">{intro}</p>}
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ComponentChildren; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      {children}
      {hint && <span class="field-hint muted">{hint}</span>}
    </label>
  );
}

function Choice<T extends string>({
  name,
  value,
  current,
  onSelect,
  title,
  description,
  children,
}: {
  name: string;
  value: T;
  current: T;
  onSelect: (value: T) => void;
  title: string;
  description: ComponentChildren;
  children?: ComponentChildren;
}) {
  const selected = value === current;
  return (
    <div class={`choice${selected ? ' choice-selected' : ''}`}>
      <label class="choice-head">
        <input type="radio" name={name} checked={selected} onChange={() => onSelect(value)} />
        <span>
          <strong>{title}</strong>
          <span class="muted choice-description">{description}</span>
        </span>
      </label>
      {selected && children && <div class="choice-body">{children}</div>}
    </div>
  );
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SavedWords() {
  const [words, setWords] = useState<SavedWord[]>([]);

  useEffect(() => {
    void getVocab().then(setWords);
    return watchVocab(setWords);
  }, []);

  const [known, setKnownKeys] = useState<string[]>([]);
  useEffect(() => {
    void getKnown().then(setKnownKeys);
    return watchKnown(setKnownKeys);
  }, []);

  const sorted = [...words].sort((a, b) => b.createdAt - a.createdAt);
  const date = new Date().toISOString().slice(0, 10);

  return (
    <Section
      title={`Saved words (${words.length})`}
      intro="Words you star in the subtitles, with the line they came from. Export them to a spreadsheet or to Anki (File → Import)."
    >
      <div class="row">
        <button
          class="button"
          disabled={words.length === 0}
          onClick={() => download(`glossa-words-${date}.csv`, `﻿${toCsv(sorted)}`, 'text/csv;charset=utf-8')}
        >
          Export CSV
        </button>
        <button
          class="button"
          disabled={words.length === 0}
          onClick={() => download(`glossa-anki-${date}.txt`, toAnkiTsv(sorted), 'text/plain;charset=utf-8')}
        >
          Export for Anki
        </button>
        <button
          class="button"
          disabled={known.length === 0}
          title="Words you marked as known in the word card; they aren't highlighted"
          onClick={() => {
            if (confirm(`Forget all ${known.length} known words?`)) void clearKnown();
          }}
        >
          Clear known words ({known.length})
        </button>
        <span class="spacer" />
        <button
          class="button danger"
          disabled={words.length === 0}
          onClick={() => {
            if (confirm(`Delete all ${words.length} saved words? This can’t be undone.`)) void clearVocab();
          }}
        >
          Delete all
        </button>
      </div>

      {sorted.length === 0 ? (
        <p class="muted">No saved words yet. Click a word in the subtitles, then the star.</p>
      ) : (
        <div class="table-wrap">
          <table class="words">
            <thead>
              <tr>
                <th>Word</th>
                <th>Translation</th>
                <th>Line</th>
                <th>Source</th>
                <th>
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((word) => (
                <tr key={word.id}>
                  <td>
                    <strong lang={word.lang}>{word.word}</strong>
                    <div class="muted small">{languageName(word.lang)}</div>
                  </td>
                  <td>{word.translation ?? <span class="muted">—</span>}</td>
                  <td lang={word.lang}>
                    {word.sentence}
                    {word.sentenceTranslation && <div class="muted small">{word.sentenceTranslation}</div>}
                  </td>
                  <td>
                    {word.source ? (
                      <a href={word.source.url} target="_blank" rel="noreferrer noopener" title={word.source.title}>
                        {word.source.title || 'Video'}
                      </a>
                    ) : (
                      <span class="muted">—</span>
                    )}
                    <div class="muted small">{new Date(word.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td>
                    <button class="button small-button" aria-label={`Delete ${word.word}`} onClick={() => void removeWord(word.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Sites where subtitles for any video start on their own, chosen from the toolbar popup. */
function VideoSites() {
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    void getVideoSites().then(setSites);
    return watchVideoSites(setSites);
  }, []);

  return (
    <Section
      title="Other sites"
      intro={
        <>
          Glossa works on YouTube by itself. On any other page with a video, click Glossa’s toolbar button and choose{' '}
          <strong>Subtitles for the video on this page</strong>. It uses the video’s own subtitles, or a .srt or .vtt
          file you load. Choose <strong>Always on</strong> there to start it on a site by itself.
        </>
      }
    >
      {sites.length === 0 ? (
        <p class="muted">No sites yet.</p>
      ) : (
        <ul class="sites">
          {sites.map((site) => (
            <li key={site}>
              <span>{site.replace(/\/\*$/, '')}</span>
              <button class="button small-button" onClick={() => void removeVideoSite(site)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Turns `code` spans in a preset hint into <code> elements. */
function renderHint(text: string): ComponentChildren {
  return text.split('`').map((part, index) => (index % 2 ? <code>{part}</code> : part));
}

function OpenAICompatibleSetup({
  ai,
  apiKey,
  changeAi,
  changeApiKey,
}: {
  ai: Settings['ai'];
  apiKey: string;
  changeAi: (patch: Partial<Settings['ai']>) => void;
  changeApiKey: (apiKey: string) => void;
}) {
  const [presetId, setPresetId] = useState(
    () => OPENAI_PRESETS.find((p) => normalizeOpenAIBaseUrl(p.baseUrl) === normalizeOpenAIBaseUrl(ai.baseUrl))?.id ?? '',
  );
  const preset = OPENAI_PRESETS.find((p) => p.id === presetId);

  const choosePreset = (id: string) => {
    const next = OPENAI_PRESETS.find((p) => p.id === id);
    setPresetId(id);
    // One key field serves every server, so a key must never be carried over to a different one.
    changeApiKey('');
    changeAi({ baseUrl: next?.baseUrl ?? '', model: next?.model ?? '' });
  };

  return (
    <>
      <Field label="Service" hint={preset ? renderHint(preset.hint) : 'Pick a service to fill in its URL and a suggested model, or enter your own below.'}>
        <select value={presetId} onChange={(event) => choosePreset(event.currentTarget.value)}>
          <option value="">Other server</option>
          {OPENAI_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Server URL"
        hint={
          <>
            Ollama: <code>http://localhost:11434/v1</code> · LM Studio: <code>http://localhost:1234/v1</code>
          </>
        }
      >
        <input
          type="url"
          value={ai.baseUrl}
          onInput={(event) => {
            setPresetId('');
            changeAi({ baseUrl: event.currentTarget.value.trim() });
          }}
          onBlur={(event) => event.currentTarget.value && changeAi({ baseUrl: normalizeOpenAIBaseUrl(event.currentTarget.value) })}
        />
      </Field>
      <Field label="Model" hint="The model name as the server knows it, e.g. qwen3.5:9b or gemma4:e4b.">
        <input type="text" value={ai.model} onInput={(event) => changeAi({ model: event.currentTarget.value.trim() })} />
      </Field>
      <Field label={preset?.needsKey ? 'API key' : 'API key (if the server needs one)'}>
        <input type="password" autocomplete="off" value={apiKey} onInput={(event) => changeApiKey(event.currentTarget.value.trim())} />
      </Field>
    </>
  );
}

function Options() {
  // What's stored (also changed from the overlay and the popup) and the edits not saved yet on top of it.
  const [stored, setStored] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [translatorTest, setTranslatorTest] = useState<Notice>(null);
  const [aiTest, setAiTest] = useState<Notice>(null);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const readingsInstalled = usePackInstalled(JAPANESE_READINGS) === true;

  useEffect(() => {
    void Promise.all([getSettings(), getSecrets()]).then(([loadedSettings, loadedSecrets]) => {
      setStored(loadedSettings);
      setSecrets(loadedSecrets);
    });
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    const unwatch = watchSettings(setStored);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      unwatch();
    };
  }, []);

  if (!stored || !secrets) return null;

  const settings: Settings = { ...stored, ...draft };
  const change = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
    setNotice(null);
  };
  const changeAi = (patch: Partial<Settings['ai']>) => change({ ai: { ...settings.ai, ...patch } });
  const changeSecret = (patch: Partial<Secrets>) => {
    setSecrets({ ...secrets, ...patch });
    setDirty(true);
    setNotice(null);
  };

  const save = () => {
    // Ask for access to the configured servers first: browsers only allow it during a click.
    requestOrigins(requiredOrigins(settings))
      .then(async (granted) => {
        // Only what was edited here: saving the whole page would undo changes made in the overlay meanwhile.
        setStored(await updateSettings(draft));
        setDraft({});
        await updateSecrets(secrets);
        setDirty(false);
        setNotice(
          granted
            ? { kind: 'ok', text: 'Settings saved.' }
            : { kind: 'error', text: 'Saved, but access to your translation/AI server wasn’t granted. Save again and choose Allow.' },
        );
      })
      .catch((error: unknown) => setNotice({ kind: 'error', text: String(error) }));
  };

  const testTranslator = () => {
    setTranslatorTest({ kind: 'ok', text: 'Testing…' });
    const run =
      settings.translator === 'browser'
        ? new BrowserTranslator().translate({ text: 'Where is the library?', from: 'en', to: settings.nativeLanguage })
        : sendMessage('testTranslator', null);
    run.then(
      (text) => setTranslatorTest({ kind: 'ok', text: `Works: “Where is the library?” → “${text}”` }),
      (error: unknown) => setTranslatorTest({ kind: 'error', text: error instanceof Error ? error.message : String(error) }),
    );
  };

  const testAi = () => {
    setAiTest({ kind: 'ok', text: 'Asking the model about “amigos” in “¡Hola, amigos!”…' });
    sendMessage('testAi', null).then(
      (text) => setAiTest({ kind: 'ok', text }),
      (error: unknown) => setAiTest({ kind: 'error', text: error instanceof Error ? error.message : String(error) }),
    );
  };

  const browserTranslatorAvailable = isBrowserTranslatorSupported();
  const version = browser.runtime.getManifest().version;

  return (
    <div class="options">
      <header class="page-header">
        <h1>Glossa</h1>
        <p class="muted">Interactive subtitles for language learners. Free and open source.</p>
      </header>

      <div class="layout">
        <nav class="nav" aria-label="Settings">
          {PAGES.map((item) => (
            <a key={item.id} href={`#${item.id}`} aria-current={item.id === page ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>

        <main class="pages">
          {page === 'general' && (
            <>
              <Section title="Your language" intro="Translations and explanations are written in this language.">
                <Field label="Translate into">
                  <select value={settings.nativeLanguage} onChange={(event) => change({ nativeLanguage: event.currentTarget.value })}>
                    {languageOptions(settings.nativeLanguage).map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section title="Subtitles">
                <Field label="Line translation">
                  <select
                    value={settings.translationDisplay}
                    onChange={(event) => change({ translationDisplay: event.currentTarget.value as Settings['translationDisplay'] })}
                  >
                    <option value="show">Show under each line</option>
                    <option value="blur">Blur until I hover over it</option>
                    <option value="hide">Hide</option>
                  </select>
                </Field>
                <label class="switch">
                  <input
                    type="checkbox"
                    checked={settings.showPreviousTranslation}
                    onChange={(event) => change({ showPreviousTranslation: event.currentTarget.checked })}
                  />
                  Translate the line before too (transcribed speech keeps it above the current line)
                </label>
                <Field label={`Size: ${Math.round(settings.fontScale * 100)}%`}>
                  <input
                    type="range"
                    min="0.6"
                    max="1.8"
                    step="0.1"
                    value={settings.fontScale}
                    onInput={(event) => change({ fontScale: Number(event.currentTarget.value) })}
                  />
                </Field>
                <Field
                  label={`Position: ${settings.subtitlePosition > 0 ? `raised ${Math.round(settings.subtitlePosition)}%` : 'bottom'}`}
                  hint="Move the subtitles up, for example when a video has subtitles burned in. You can also drag them by the Glossa label above the line."
                >
                  <input
                    type="range"
                    min="0"
                    max={MAX_SUBTITLE_POSITION}
                    step="1"
                    value={settings.subtitlePosition}
                    onInput={(event) => change({ subtitlePosition: Number(event.currentTarget.value) })}
                  />
                </Field>
                <label class="switch">
                  <input
                    type="checkbox"
                    checked={settings.showReadings}
                    onChange={(event) => change({ showReadings: event.currentTarget.checked })}
                  />
                  <span>
                    Readings over characters: pinyin (Chinese), furigana or romaji (Japanese)
                    {!readingsInstalled && (
                      <span class="muted">
                        {' '}
                        · Japanese needs the <a href="#packs">Japanese readings pack</a>
                      </span>
                    )}
                  </span>
                </label>
                <Field label="Japanese readings">
                  <select
                    value={settings.japaneseReadings}
                    onChange={(event) => change({ japaneseReadings: event.currentTarget.value as Settings['japaneseReadings'] })}
                  >
                    <option value="kana">Furigana: kana over the kanji</option>
                    <option value="romaji">Romaji over each word</option>
                  </select>
                </Field>
              </Section>

              <Section title="Behaviour">
                <label class="switch">
                  <input type="checkbox" checked={settings.pauseOnHover} onChange={(event) => change({ pauseOnHover: event.currentTarget.checked })} />
                  Pause while the mouse is over the subtitles
                </label>
                <label class="switch">
                  <input type="checkbox" checked={settings.autoPause} onChange={(event) => change({ autoPause: event.currentTarget.checked })} />
                  Pause after every line
                </label>
                <label class="switch">
                  <input type="checkbox" checked={settings.markNewWords} onChange={(event) => change({ markNewWords: event.currentTarget.checked })} />
                  Underline words I haven’t saved or marked as known
                </label>
              </Section>

              <Section title="Keyboard shortcuts" intro="While watching a video.">
                <dl class="shortcuts">
                  {SHORTCUTS.map(([key, action]) => (
                    <div key={key}>
                      <dt>
                        <kbd>{key}</kbd>
                      </dt>
                      <dd>{action}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </>
          )}

          {page === 'translation' && (
            <Section
              title="Translation"
              intro="Whole lines are translated by YouTube when it can, or taken from a video’s subtitles in your language. This translator handles single words and all other lines."
            >
              <div class="choices">
                <Choice<TranslatorChoice>
                  name="translator"
                  value="browser"
                  current={settings.translator}
                  onSelect={(translator) => change({ translator })}
                  title="Built-in browser translator"
                  description={
                    browserTranslatorAvailable
                      ? 'Free and private: runs on your device. Available in this browser.'
                      : 'Free and private, but not available in this browser (needs Chrome or Edge 138+). Choose another option.'
                  }
                />
                <Choice<TranslatorChoice>
                  name="translator"
                  value="libretranslate"
                  current={settings.translator}
                  onSelect={(translator) => change({ translator })}
                  title="LibreTranslate"
                  description="Open-source translation server you can host yourself."
                >
                  <Field label="Server URL" hint="For a local Docker install this is usually http://localhost:5000.">
                    <input
                      type="url"
                      value={settings.libreTranslateUrl}
                      onInput={(event) => change({ libreTranslateUrl: event.currentTarget.value.trim() })}
                    />
                  </Field>
                  <Field label="API key (optional)">
                    <input
                      type="password"
                      autocomplete="off"
                      value={secrets.libreTranslateApiKey}
                      onInput={(event) => changeSecret({ libreTranslateApiKey: event.currentTarget.value.trim() })}
                    />
                  </Field>
                </Choice>
                <Choice<TranslatorChoice>
                  name="translator"
                  value="deepl"
                  current={settings.translator}
                  onSelect={(translator) => change({ translator })}
                  title="DeepL"
                  description="High-quality translation. The free API plan covers 500,000 characters a month."
                >
                  <Field label="DeepL API key">
                    <input
                      type="password"
                      autocomplete="off"
                      value={secrets.deeplApiKey}
                      onInput={(event) => changeSecret({ deeplApiKey: event.currentTarget.value.trim() })}
                    />
                  </Field>
                </Choice>
                <Choice<TranslatorChoice>
                  name="translator"
                  value="ai"
                  current={settings.translator}
                  onSelect={(translator) => change({ translator })}
                  title="AI model"
                  description="Uses the AI model set up below. Good with slang and context, but slower."
                />
              </div>
              <div class="row">
                <button class="button" onClick={testTranslator} disabled={dirty}>
                  Test translator
                </button>
                {dirty && <span class="muted">Save your changes to test them.</span>}
                {translatorTest && <span class={translatorTest.kind}>{translatorTest.text}</span>}
              </div>
            </Section>
          )}

          {page === 'ai' && (
            <Section
              title="AI explanations (optional)"
              intro="Explains a word or line in context: meaning, dictionary form, grammar and idioms. When you ask, the word, its subtitle line and the lines around it go to the model you choose. The first two options keep everything on this computer."
            >
              <div class="choices">
                <Choice<AiProvider>
                  name="ai"
                  value="none"
                  current={settings.ai.provider}
                  onSelect={(provider) => changeAi({ provider })}
                  title="Off"
                  description="Dictionary definitions and translations only."
                />
                <Choice<AiProvider>
                  name="ai"
                  value="built-in"
                  current={settings.ai.provider}
                  onSelect={(provider) => changeAi({ provider })}
                  title="Built into the browser"
                  description="Free and private. Chrome’s own model (Gemini Nano) runs on this computer. Best in English, Spanish, Japanese, German and French."
                >
                  <BuiltInModelSetup language={settings.nativeLanguage} />
                </Choice>
                <Choice<AiProvider>
                  name="ai"
                  value="on-device"
                  current={settings.ai.provider}
                  onSelect={(provider) => changeAi({ provider })}
                  title="Glossa’s on-device model"
                  description="Free and private. Downloads an open model (Qwen3.5) once, then runs it on your graphics card, even offline. Knows many languages."
                >
                  <OnDeviceModelSetup value={settings.ai.onDeviceModel} onChange={(onDeviceModel) => changeAi({ onDeviceModel })} />
                </Choice>
                <Choice<AiProvider>
                  name="ai"
                  value="anthropic"
                  current={settings.ai.provider}
                  onSelect={(provider) => changeAi({ provider, model: '' })}
                  title="Claude (Anthropic)"
                  description={
                    <>
                      Needs an API key from{' '}
                      <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer noopener">
                        console.anthropic.com
                      </a>
                      . You pay Anthropic per use.
                    </>
                  }
                >
                  <Field label="Anthropic API key">
                    <input
                      type="password"
                      autocomplete="off"
                      value={secrets.anthropicApiKey}
                      onInput={(event) => changeSecret({ anthropicApiKey: event.currentTarget.value.trim() })}
                    />
                  </Field>
                  <Field label="Model" hint={`Leave empty to use ${DEFAULT_ANTHROPIC_MODEL}.`}>
                    <input
                      type="text"
                      placeholder={DEFAULT_ANTHROPIC_MODEL}
                      value={settings.ai.model}
                      onInput={(event) => changeAi({ model: event.currentTarget.value.trim() })}
                    />
                  </Field>
                </Choice>
                <Choice<AiProvider>
                  name="ai"
                  value="openai-compatible"
                  current={settings.ai.provider}
                  onSelect={(provider) => changeAi({ provider, model: '' })}
                  title="OpenAI, Gemini, Ollama or another server"
                  description="Any service or server with an OpenAI-compatible API: hosted (OpenAI, Gemini, Groq, Mistral, OpenRouter…), on your computer, or on your network. Bigger models give better answers."
                >
                  <OpenAICompatibleSetup
                    ai={settings.ai}
                    apiKey={secrets.openaiCompatibleApiKey}
                    changeAi={changeAi}
                    changeApiKey={(openaiCompatibleApiKey) => changeSecret({ openaiCompatibleApiKey })}
                  />
                </Choice>
              </div>
              {settings.ai.provider !== 'none' && (
                <div class="row">
                  <button class="button" onClick={testAi} disabled={dirty}>
                    Test AI
                  </button>
                  {dirty && <span class="muted">Save your changes to test them.</span>}
                  {aiTest && <span class={`${aiTest.kind} pre`}>{aiTest.text}</span>}
                </div>
              )}
              <p class="muted small">API keys are stored only in this browser and are sent only to the provider they belong to.</p>
            </Section>
          )}

          {page === 'packs' && (
            <Section
              title="Optional packs"
              intro="Extra data that isn’t part of Glossa. Nothing is downloaded until you press Install, and it works offline afterwards."
            >
              <OptionalPacks />
              <div class="pack">
                <label class="switch">
                  <input type="checkbox" checked={settings.lookAhead} onChange={(event) => change({ lookAhead: event.currentTarget.checked })} />
                  On YouTube, transcribe ahead from the audio the player has already loaded (experimental)
                </label>
                {settings.lookAhead && (
                  <Field label="Live streams: stay behind the live edge">
                    <select value={settings.liveDelay} onChange={(event) => change({ liveDelay: Number(event.currentTarget.value) })}>
                      <option value={0}>Off (play at the live edge)</option>
                      <option value={10}>10 seconds</option>
                      <option value={20}>20 seconds</option>
                      <option value={30}>30 seconds</option>
                    </select>
                  </Field>
                )}
              </div>
              {browser.offscreen && <CompanionSetup enabled={settings.companion} onToggle={(on) => change({ companion: on })} />}
              {browser.offscreen && (
                <ChromeSpeechSetup enabled={settings.chromeSpeech} language={settings.spokenLanguage} onToggle={(on) => change({ chromeSpeech: on })} />
              )}
            </Section>
          )}

          {page === 'sites' && <VideoSites />}

          {page === 'words' && <SavedWords />}
        </main>
      </div>

      <footer class="page-footer muted small">
        Glossa {version} · Licensed under the GNU AGPL v3 or later · Dictionary data from Wiktionary (CC BY-SA)
      </footer>

      {(dirty || notice) && (
        <div class="save-bar" role="status">
          {notice && <span class={notice.kind}>{notice.text}</span>}
          {dirty && (
            <button class="button primary" onClick={save}>
              Save changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
