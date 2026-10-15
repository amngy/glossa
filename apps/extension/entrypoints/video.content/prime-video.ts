import { baseLanguage, languageName, parseTtmlSubtitles, type PrimeVideoSubtitle } from '@glossa/core';
import type { ContentScriptContext } from '#imports';
import type { Store } from '@/lib/store';
import type { OverlayState } from '@/components/overlay/state';
import { PRIME_FROM_PAGE, PRIME_TO_PAGE, type PrimeReplayMessage, type PrimeSubtitlesMessage } from '@/lib/prime-video-bridge';
import type { VideoController } from './controller';

/**
 * Prime Video lists its subtitle files (TTML) in the player's playback-resources response, which
 * entrypoints/prime-video-hook.content.ts passes on. Glossa downloads the one in the viewer's own language
 * (the line translation) and the one in the spoken language last picked in the popup (the study line):
 * the listing doesn't say which audio plays. Experimental: not yet checked on a live account (#80).
 */
export function startPrimeVideo(ctx: ContentScriptContext, controller: VideoController, store: Store<OverlayState>): void {
  let loaded = '';
  const find = (subtitles: PrimeVideoSubtitle[], lang: string) => subtitles.find((file) => baseLanguage(file.lang) === lang);

  async function load({ title, subtitles }: PrimeSubtitlesMessage): Promise<void> {
    if (title === loaded) return;
    loaded = title;
    controller.clearSiteFiles();
    const { settings } = store.get();
    const native = baseLanguage(settings.nativeLanguage);
    const spoken = baseLanguage(settings.spokenLanguage);
    // The translation first, so the study line (added last) is the one shown.
    for (const file of [find(subtitles, native), spoken && spoken !== native ? find(subtitles, spoken) : undefined]) {
      if (!file) continue;
      const response = await fetch(file.url, { credentials: 'omit' });
      if (!response.ok || loaded !== title) continue;
      const cues = parseTtmlSubtitles(await response.text());
      if (cues.length > 0) controller.addSiteFile(file.url, { lang: file.lang, label: languageName(file.lang), cues }, false);
    }
  }

  ctx.addEventListener(window, 'message', (event: MessageEvent<PrimeSubtitlesMessage>) => {
    if (event.source !== window || event.data?.source !== PRIME_FROM_PAGE || event.data.type !== 'subtitles') return;
    load(event.data).catch((error: unknown) => console.warn('Glossa: couldn’t load Prime Video’s subtitles', error));
  });
  window.postMessage({ source: PRIME_TO_PAGE, type: 'replay' } satisfies PrimeReplayMessage, location.origin);

  // Prime Video draws its own subtitles over the video; hide them while Glossa shows a line.
  const style = document.createElement('style');
  style.textContent = '.atvwebplayersdk-captions-overlay { visibility: hidden !important; }';
  const hideOwnSubtitles = () => {
    const { settings, track } = store.get();
    if (settings.enabled && track) document.head.append(style);
    else style.remove();
  };
  ctx.onInvalidated(store.subscribe(hideOwnSubtitles));
  ctx.onInvalidated(() => style.remove());
}
