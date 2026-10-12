import { browser, defineBackground } from '#imports';
import { LlmExplainer, LruCache, WiktionaryDictionary } from '@glossa/core';
import { handleMessages } from '@/lib/messages';
import { askOffscreen } from '@/lib/on-device-client';
import { createChatModel, createTranslator, describeNetworkError } from '@/lib/providers';
import { syncServerRules } from '@/lib/server-rules';
import { getSettings, updateSettings, watchSettings } from '@/lib/settings';
import { syncVideoSites, watchVideoSites } from '@/lib/video-sites';

export default defineBackground(() => {
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
  });
});
