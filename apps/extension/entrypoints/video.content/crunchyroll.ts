import { baseLanguage, languageName, parseAssSubtitles, parseTextSubtitles } from '@glossa/core';
import type { ContentScriptContext } from '#imports';
import type { Store } from '@/lib/store';
import type { OverlayState } from '@/components/overlay/state';
import {
  CRUNCHYROLL_FROM_PAGE,
  CRUNCHYROLL_TO_PAGE,
  type CrunchyrollPlayMessage,
  type CrunchyrollReplayMessage,
} from '@/lib/crunchyroll-bridge';
import type { VideoController } from './controller';

/**
 * Crunchyroll lists its subtitle files in each episode's `play` response, which
 * entrypoints/crunchyroll-hook.content.ts passes on. Glossa downloads only the file in the viewer's own
 * language (the line translation) and one in the audio's language, if there is one (the study line).
 * Usually there isn't, so the study line comes from transcribing the audio.
 */
export function startCrunchyroll(ctx: ContentScriptContext, controller: VideoController, store: Store<OverlayState>): void {
  let episode = '';

  async function load({ episode: id, audioLocale, subtitles }: CrunchyrollPlayMessage): Promise<void> {
    if (id === episode) return;
    episode = id;
    controller.clearSiteFiles();
    const native = baseLanguage(store.get().settings.nativeLanguage);
    const audio = audioLocale ? baseLanguage(audioLocale) : '';
    // The translation first, so the study line (added last) is the one shown.
    const wanted = [
      subtitles.find((file) => baseLanguage(file.lang) === native),
      audio !== native ? subtitles.find((file) => baseLanguage(file.lang) === audio) : undefined,
    ];
    for (const file of wanted) {
      if (!file) continue;
      const response = await fetch(file.url, { credentials: 'omit' });
      if (!response.ok || episode !== id) continue;
      const body = await response.text();
      const cues = file.format === 'ass' ? parseAssSubtitles(body) : parseTextSubtitles(body);
      if (cues.length > 0) controller.addSiteFile(file.url, { lang: file.lang, label: languageName(file.lang), cues }, false);
    }
  }

  ctx.addEventListener(window, 'message', (event: MessageEvent<CrunchyrollPlayMessage>) => {
    if (event.source !== window || event.data?.source !== CRUNCHYROLL_FROM_PAGE || event.data.type !== 'play') return;
    load(event.data).catch((error: unknown) => console.warn('Glossa: couldn’t load Crunchyroll’s subtitles', error));
  });
  window.postMessage({ source: CRUNCHYROLL_TO_PAGE, type: 'replay' } satisfies CrunchyrollReplayMessage, location.origin);
}
