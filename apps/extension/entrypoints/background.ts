import { browser, defineBackground } from '#imports';
import { baseLanguage, chineseReadings, COMPANION_HOST, decodePcm, LlmDictionary, LlmExplainer, LruCache, WiktionaryDictionary } from '@glossa/core';
import { COMPANION_STREAM, CompanionSpeechModel, type CompanionStreamMessage } from '@/lib/companion';
import { isAsrEnvelope, type AsrEnvelope } from '@/lib/asr';
import { handleMessages, type MessageMap } from '@/lib/messages';
import { askOffscreen } from '@/lib/on-device-client';
import { createChatModel, createTranslator, describeNetworkError } from '@/lib/providers';
import { syncServerRules } from '@/lib/server-rules';
import { getSettings, updateSettings, watchSettings } from '@/lib/settings';
import { spokenLanguageFor, startTranscribing, TAB_CAPTURE, usesLookAhead } from '@/lib/transcribe';
import { syncVideoSites, watchVideoSites } from '@/lib/video-sites';

export default defineBackground(() => {
  /** The tab whose audio is being transcribed. Lost if the browser restarts this worker; the popup then offers Start again. */
  let asrTab: number | null = null;
  const companion = new CompanionSpeechModel();
  const dictionary = new WiktionaryDictionary();
  // Best effort: the browser may stop this worker when idle, which clears the cache.
  const cache = new LruCache<string, Promise<unknown>>(1000);

  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const pending = load().catch((error: unknown) => {
      cache.delete(key); // don't cache failures
      throw describeNetworkError(error);
    });
    cache.set(key, pending);
    return pending;
  }

  void getSettings().then(syncServerRules);
  watchSettings((settings) => void syncServerRules(settings));

  // Sites where subtitles for any video start on their own. Also re-checked when the
  // browser starts, and when the viewer grants or revokes a site in the browser's own settings.
  void syncVideoSites();
  watchVideoSites(() => void syncVideoSites());
  browser.runtime.onStartup.addListener(() => void syncVideoSites());
  browser.permissions.onAdded.addListener(() => void syncVideoSites());
  browser.permissions.onRemoved.addListener(() => void syncVideoSites());

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== 'install') return;
    // Persist defaults (e.g. the detected native language), then let the user review them.
    await updateSettings(await getSettings());
    await browser.runtime.openOptionsPage();
  });

  async function asrStart({ tabId, streamId, language, pack }: MessageMap['asrStart']['request']): Promise<null> {
    let notice: string | undefined;
    // Audio goes to the companion if it answers (tab audio only if it has a live engine); otherwise to the pack.
    if ((await getSettings()).companion) {
      try {
        const { live } = await companion.ping();
        if (streamId && !live) throw new Error('No live engine.');
        pack = COMPANION_HOST;
      } catch {
        if (!pack) throw new Error('The desktop companion can’t take this audio and no speech pack is installed. See Settings → Optional packs.');
        notice = 'The desktop companion can’t take this audio, so the speech pack is used. Loading it…';
      }
    }
    await askOffscreen({ type: 'asr-start', tabId, streamId, language, pack, notice });
    return null;
  }

  handleMessages({
    async translate(request) {
      const settings = await getSettings();
      // AI models and DeepL also read the surrounding lines, so the same word can translate differently.
      const usesContext = settings.translator === 'ai' || settings.translator === 'deepl';
      const context = usesContext ? `|${JSON.stringify([request.sentence ?? '', request.context ?? null])}` : '';
      const aiModel = settings.ai.provider === 'on-device' ? settings.ai.onDeviceModel : settings.ai.model;
      const key = `t|${settings.translator}|${settings.ai.provider}:${aiModel}|${request.from}>${request.to}|${request.text}${context}`;
      return cached(key, async () => (await createTranslator()).translate(request));
    },

    lookup({ word, lang }) {
      return cached(`d|${lang}|${word}`, () => dictionary.lookup(word, lang));
    },

    // On request only: it sends the word to the viewer's AI model, for what Wiktionary lacks.
    async lookupAi({ word, lang }) {
      const [model, settings] = await Promise.all([createChatModel(), getSettings()]);
      if (!model) throw new Error('Choose an AI provider in Glossa’s settings.');
      const key = `da|${model.name}|${settings.nativeLanguage}|${lang}|${word}`;
      return cached(key, () => new LlmDictionary(model, settings.nativeLanguage).lookup(word, lang));
    },

    async explain(request) {
      const model = await createChatModel();
      if (!model) throw new Error('Choose an AI provider in Glossa’s settings to get explanations.');
      const key = `e|${model.name}|${JSON.stringify(request)}`;
      return cached(key, () => new LlmExplainer(model).explain(request));
    },

    async testAi() {
      const [model, settings] = await Promise.all([createChatModel(), getSettings()]);
      if (!model) throw new Error('No AI provider selected.');
      return new LlmExplainer(model)
        .explain({
          kind: 'word',
          word: 'amigos',
          sentence: '¡Hola, amigos!',
          lang: 'es',
          explainIn: settings.nativeLanguage,
        })
        .catch((error: unknown) => Promise.reject(describeNetworkError(error)));
    },

    async testTranslator() {
      const settings = await getSettings();
      const translator = await createTranslator();
      return translator
        .translate({ text: 'Where is the library?', from: 'en', to: settings.nativeLanguage })
        .catch((error: unknown) => Promise.reject(describeNetworkError(error)));
    },

    async openOptions() {
      await browser.runtime.openOptionsPage();
      return null;
    },

    onDeviceStatus: ({ model }) => askOffscreen({ type: 'status', model }),
    onDeviceDownload: ({ model }) => askOffscreen({ type: 'download', model }),
    onDeviceDelete: ({ model }) => askOffscreen({ type: 'delete', model }),

    // Pinyin's dictionary is bundled and small enough for this worker; Japanese needs kuromoji in the offscreen document.
    readings: async ({ text, lang }) =>
      baseLanguage(lang) === 'zh' ? chineseReadings(text) : cached(`r|${text}`, () => askOffscreen({ type: 'readings', text })),

    asrStart,
    async asrHold({ hold }) {
      await askOffscreen({ type: 'asr-hold', hold });
      return null;
    },
    async asrStop() {
      await askOffscreen({ type: 'asr-stop' });
      return null;
    },
    companionPing: () => companion.ping(),
    // Native messaging is only open to extension pages and this worker, not the offscreen document.
    companionTranscribe: ({ pcm, language }) => companion.transcribe(decodePcm(pcm), { language }),
    asrStatus: async () => ({ tabId: asrTab }),
  });

  // The shortcut starts or stops transcribing the current tab, like the popup's button.
  browser.commands?.onCommand.addListener(async (command, tab) => {
    if (command !== 'transcribe' || tab?.id === undefined) return;
    if (asrTab === tab.id) return void askOffscreen({ type: 'asr-stop' }).catch(() => {});
    const settings = await getSettings();
    // Without the audio permission, the popup asks for it (a shortcut can't).
    if (!usesLookAhead(tab, settings) && !(await browser.permissions.contains(TAB_CAPTURE))) return void browser.action.openPopup().catch(() => {});
    const tabId = tab.id;
    startTranscribing(tab, settings, await spokenLanguageFor(tab.url, settings), asrStart).catch((error: unknown) => {
      const event = { kind: 'error', message: error instanceof Error ? error.message : String(error) } as const;
      void browser.tabs.sendMessage(tabId, { glossaAsr: true, tabId, event } satisfies AsrEnvelope).catch(() => {});
    });
  });

  // The stream follows the tab to its next page, so stop listening when the tab leaves the video.
  const stopIfListening = (tabId: number) => {
    if (tabId === asrTab) void askOffscreen({ type: 'asr-stop' }).catch(() => {});
  };
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) stopIfListening(tabId);
  });
  browser.tabs.onRemoved.addListener(stopIfListening);

  // Live tab audio from the offscreen document, which can't use native messaging: the first message
  // names the language, the rest carry audio. Closing the port ends the stream.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== COMPANION_STREAM || port.sender?.id !== browser.runtime.id) return;
    let stream: ReturnType<CompanionSpeechModel['stream']> | null = null;
    port.onMessage.addListener((message: CompanionStreamMessage) => {
      if ('language' in message) stream ??= companion.stream(message.language, (reply) => port.postMessage(reply));
      else stream?.push(message.pcm);
    });
    port.onDisconnect.addListener(() => stream?.stop());
  });

  // Recognised lines come from the offscreen document and belong to the tab that was listened to.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== browser.runtime.id || !isAsrEnvelope(message)) return;
    if (message.event.kind === 'loading') asrTab = message.tabId;
    else if (message.event.kind === 'stopped' || message.event.kind === 'error') asrTab = null;
    void browser.tabs.sendMessage(message.tabId, message).catch(() => {});
  });
});
