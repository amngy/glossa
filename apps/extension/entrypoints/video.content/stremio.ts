import { languageFromSubtitleCode, languageName, parseTextSubtitles } from '@glossa/core';
import type { ContentScriptContext } from '#imports';
import { fallbackLanguage, sampleText } from '@/components/overlay/controller';
import type { OverlayState } from '@/components/overlay/state';
import { detectLanguage } from '@/lib/detect-language';
import type { Store } from '@/lib/store';
import { STREMIO_FROM_PAGE, STREMIO_TO_PAGE, type StremioReplayMessage, type StremioSubtitleMessage } from '@/lib/stremio-bridge';
import type { VideoController } from './controller';

/**
 * Stremio Web draws subtitles from files it downloads itself, so the page has no <track>s.
 * entrypoints/stremio-hook.content.ts copies those files; this turns them into Glossa tracks
 * and hides Stremio's own subtitles while Glossa shows its own.
 */
export function startStremio(ctx: ContentScriptContext, controller: VideoController, store: Store<OverlayState>): void {
  const labels = new Map<string, number>();
  // Language detection is async; this keeps the files in download order, so the latest stays the picked one.
  let queue = Promise.resolve();

  async function add({ url, lang: code, body }: StremioSubtitleMessage): Promise<void> {
    const cues = parseTextSubtitles(body);
    if (cues.length === 0) return;
    const known = code ? languageFromSubtitleCode(code) : null;
    const lang = known ?? (await detectLanguage(sampleText(cues))) ?? fallbackLanguage();
    const name = languageName(lang);
    const count = (labels.get(name) ?? 0) + 1;
    labels.set(name, count);
    controller.addSiteFile(url, { lang, label: count > 1 ? `${name} ${count}` : name, cues }, !known);
  }

  ctx.addEventListener(window, 'message', (event: MessageEvent<StremioSubtitleMessage>) => {
    if (event.source !== window || event.data?.source !== STREMIO_FROM_PAGE || event.data.type !== 'subtitle') return;
    const message = event.data;
    queue = queue.then(() => add(message)).catch(() => {});
  });
  // Each video plays on its own route (#/player/…); the files so far belong to the last one.
  ctx.addEventListener(window, 'hashchange', () => {
    labels.clear();
    controller.clearSiteFiles();
  });
  window.postMessage({ source: STREMIO_TO_PAGE, type: 'replay' } satisfies StremioReplayMessage, location.origin);

  const hidden = new Set<HTMLElement>();
  const hideOwnSubtitles = () => {
    const { settings, track } = store.get();
    const hide = settings.enabled && !!track;
    for (const element of hidden) if (!hide || !element.isConnected) element.style.visibility = '';
    hidden.clear();
    if (!hide) return;
    // Stremio's player draws its subtitles in a div next to the <video> (stremio-video's withHTMLSubtitles).
    for (const video of document.querySelectorAll('video')) {
      for (const element of video.parentElement?.children ?? []) {
        if (!(element instanceof HTMLDivElement) || element.style.position !== 'absolute' || element.style.textAlign !== 'center') continue;
        element.style.visibility = 'hidden';
        hidden.add(element);
      }
    }
  };
  ctx.onInvalidated(store.subscribe(hideOwnSubtitles));
  ctx.onInvalidated(() => {
    for (const element of hidden) element.style.visibility = '';
  });
}
