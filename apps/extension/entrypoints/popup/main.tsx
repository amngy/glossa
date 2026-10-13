import '@/assets/page.css';
import './style.css';
import { browser, type Browser } from '#imports';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { baseLanguage } from '@glossa/core';
import { languageOptions } from '@/lib/languages';
import { sendMessage } from '@/lib/messages';
import { installedSpeechPack, type Pack } from '@/lib/packs';
import { getSettings, updateSettings, watchSettings, type Settings } from '@/lib/settings';
import {
  addVideoSite,
  grantedVideoSites,
  removeVideoSite,
  startOnTab,
  videoSitePattern,
  watchVideoSites,
} from '@/lib/video-sites';
import { getVocab, watchVocab } from '@/lib/vocab-store';

const TRANSLATOR_NAMES: Record<Settings['translator'], string> = {
  browser: 'Built-in browser translator',
  ai: 'AI model',
  libretranslate: 'LibreTranslate',
  deepl: 'DeepL',
};

const AI_NAMES: Record<Settings['ai']['provider'], string> = {
  none: 'Off',
  'built-in': 'Built into the browser',
  'on-device': 'On this device',
  anthropic: 'Claude',
  'openai-compatible': 'Your own server',
};

function isYouTube(url: string | undefined): boolean {
  try {
    return !!url && /(^|\.)youtube\.com$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Starts subtitles for the video on the current page, and turns them on for the whole site. */
function PageVideo({ tab }: { tab: Browser.tabs.Tab }) {
  const pattern = videoSitePattern(tab.url);
  const [always, setAlways] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pattern) return;
    const update = () => void grantedVideoSites().then((sites) => setAlways(sites.includes(pattern)));
    update();
    return watchVideoSites(update);
  }, [pattern]);

  if (!pattern || tab.id === undefined) return null;
  const tabId = tab.id;
  const host = pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');

  const start = () => {
    setMessage('Looking for a video…');
    startOnTab(tabId).then(
      (videos) => {
        if (videos > 0) window.close();
        else setMessage('No video here yet. Glossa will show its subtitles when one starts playing.');
      },
      () => setMessage('Glossa can’t run on this page.'),
    );
  };

  const toggleAlways = (on: boolean) => {
    if (!on) {
      void removeVideoSite(pattern);
      return;
    }
    // Called straight from the click: the browser asks for access to this site.
    addVideoSite(pattern).then(
      (granted) => {
        if (granted) start();
      },
      () => setMessage('Glossa can’t run on this site.'),
    );
  };

  return (
    <section class="popup-page">
      <button class="button primary popup-wide" onClick={start}>
        Subtitles for the video on this page
      </button>
      <label class="switch popup-always">
        <input type="checkbox" checked={always} onChange={(event) => toggleAlways(event.currentTarget.checked)} />
        Always on {host}
      </label>
      {message && <p class="popup-hint muted">{message}</p>}
    </section>
  );
}

/**
 * Recognises the speech in this tab's audio on this device, for videos without subtitles. It needs a
 * speech pack from Settings, and the tab's audio permission, which the browser asks for on first use.
 */
function Transcribe({ tab, settings }: { tab: Browser.tabs.Tab; settings: Settings }) {
  const [pack, setPack] = useState<Pack | null | undefined>(undefined);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const tabId = tab.id;
  const language = settings.spokenLanguage || (baseLanguage(settings.nativeLanguage) === 'ja' ? 'en' : 'ja');
  // Look-ahead reads the audio YouTube's player has buffered, so it needs no tab capture.
  const ahead = settings.lookAhead && isYouTube(tab.url);

  useEffect(() => {
    void installedSpeechPack().then((installed) => setPack(installed ?? null));
    void sendMessage('asrStatus', null).then(({ tabId: current }) => setActive(current === tabId), () => {});
  }, [tabId]);

  if (tabId === undefined || pack === undefined) return null;

  if (pack === null) {
    return (
      <section class="popup-page">
        <p class="popup-hint muted">No subtitles? Glossa can write them from the video’s sound, on this device.</p>
        <button class="button popup-wide" onClick={() => void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#packs` })}>
          Add speech recognition in Settings
        </button>
      </section>
    );
  }

  const start = async () => {
    setMessage('Starting…');
    try {
      if (ahead) {
        if (language !== settings.spokenLanguage) void updateSettings({ spokenLanguage: language });
        await sendMessage('asrStart', { tabId, language, pack: pack.id });
        window.close();
        return;
      }
      const permission = { permissions: ['tabCapture'] as Browser.runtime.ManifestPermission[] };
      if (!(await browser.permissions.contains(permission)) && !(await browser.permissions.request(permission))) {
        setMessage('Glossa needs permission to listen to this tab’s audio.');
        return;
      }
      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
      // Other sites need Glossa's overlay started first; YouTube's is always there.
      if (!isYouTube(tab.url)) await startOnTab(tabId);
      if (language !== settings.spokenLanguage) void updateSettings({ spokenLanguage: language });
      await sendMessage('asrStart', { tabId, streamId, language, pack: pack.id });
      window.close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const stop = () => {
    void sendMessage('asrStop', null).then(() => window.close());
  };

  return (
    <section class="popup-page">
      {active ? (
        <button class="button popup-wide" onClick={stop}>
          Stop transcribing
        </button>
      ) : (
        <>
          <label class="popup-field">
            <span>Spoken language</span>
            <select value={language} onChange={(event) => void updateSettings({ spokenLanguage: event.currentTarget.value })}>
              {languageOptions(language).map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button class="button primary popup-wide" onClick={() => void start()}>
            Transcribe this video’s audio
          </button>
          <p class="popup-hint muted">
            {ahead
              ? 'On this device, from the audio YouTube has already loaded, so lines can be ready before they’re spoken.'
              : 'On this device. Lines appear a few seconds after they’re spoken.'}
          </p>
        </>
      )}
      {message && <p class="popup-hint muted">{message}</p>}
    </section>
  );
}

function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [tab, setTab] = useState<Browser.tabs.Tab | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
    void getVocab().then((words) => setSavedCount(words.length));
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => setTab(active ?? null));
    const unwatchSettings = watchSettings(setSettings);
    const unwatchVocab = watchVocab((words) => setSavedCount(words.length));
    return () => {
      unwatchSettings();
      unwatchVocab();
    };
  }, []);

  if (!settings) return null;

  const openWords = () => {
    void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#words` });
    window.close();
  };

  const openSettings = () => {
    void browser.runtime.openOptionsPage();
    window.close();
  };

  return (
    <main class="popup">
      <header class="popup-header">
        <h1>Glossa</h1>
        <label class="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => void updateSettings({ enabled: event.currentTarget.checked })}
          />
          {settings.enabled ? 'On' : 'Off'}
        </label>
      </header>

      <label class="popup-field">
        <span>Translate into</span>
        <select
          value={settings.nativeLanguage}
          onChange={(event) => void updateSettings({ nativeLanguage: event.currentTarget.value })}
        >
          {languageOptions(settings.nativeLanguage).map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <dl class="popup-summary">
        <dt>Translator</dt>
        <dd>{TRANSLATOR_NAMES[settings.translator]}</dd>
        <dt>AI explanations</dt>
        <dd>{AI_NAMES[settings.ai.provider]}</dd>
      </dl>

      {settings.enabled && tab && !isYouTube(tab.url) && <PageVideo tab={tab} />}
      {settings.enabled && tab && browser.offscreen && <Transcribe tab={tab} settings={settings} />}

      <p class="popup-hint muted">
        Open a YouTube video, or any video with subtitles, and click any word in the subtitles. <kbd>A</kbd>{' '}
        <kbd>S</kbd> <kbd>D</kbd>: previous, replay, next line. <kbd>Q</kbd>: show, blur or hide the translation.
      </p>

      <footer class="popup-actions">
        <button class="button" onClick={openWords}>
          Saved words ({savedCount})
        </button>
        <button class="button primary" onClick={openSettings}>
          Settings
        </button>
      </footer>
    </main>
  );
}

render(<Popup />, document.getElementById('app')!);
