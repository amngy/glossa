import { baseLanguage, languageName, parseTextSubtitles } from '@glossa/core';
import type { ContentScriptContext } from '#imports';
import type { Store } from '@/lib/store';
import type { OverlayState } from '@/components/overlay/state';
import { NETFLIX_FROM_PAGE, NETFLIX_TO_PAGE, type NetflixToPageMessage, type NetflixTracksMessage } from '@/lib/netflix-bridge';
import type { VideoController } from './controller';

/**
 * Netflix lists every subtitle file in the title's manifest, which entrypoints/netflix-hook.content.ts
 * passes on. Glossa downloads the one in the viewer's own language (the line translation) and the one
 * in the audio's language (the study line). Experimental: not yet checked on a live account (#9).
 */
export function startNetflix(ctx: ContentScriptContext, controller: VideoController, store: Store<OverlayState>): void {
  let loaded = '';
  const toPage = (message: NetflixToPageMessage) => window.postMessage(message, location.origin);

  // Netflix's player stops with an error when `video.currentTime` is set; its own API seeks.
  controller.seek = (_video, seconds) => toPage({ source: NETFLIX_TO_PAGE, type: 'seek', seconds });

  // Plain subtitles before closed captions, which add sound descriptions.
  const pick = (tracks: NetflixTracksMessage['tracks'], lang: string) =>
    tracks.find((t) => baseLanguage(t.lang) === lang && !t.closedCaptions) ?? tracks.find((t) => baseLanguage(t.lang) === lang);

  async function load({ movie, audio, tracks }: NetflixTracksMessage): Promise<void> {
    const key = `${movie}|${audio ?? ''}`;
    if (key === loaded) return;
    loaded = key;
    controller.clearSiteFiles();
    const native = baseLanguage(store.get().settings.nativeLanguage);
    const spoken = audio ? baseLanguage(audio) : '';
    // The translation first, so the study line (added last) is the one shown.
    const wanted = [pick(tracks, native), spoken && spoken !== native ? pick(tracks, spoken) : undefined];
    for (const file of wanted) {
      if (!file) continue;
      const response = await fetch(file.url, { credentials: 'omit' });
      if (!response.ok || loaded !== key) continue;
      const cues = parseTextSubtitles(await response.text());
      if (cues.length > 0) controller.addSiteFile(file.url, { lang: file.lang, label: languageName(file.lang), cues }, false);
    }
  }

  ctx.addEventListener(window, 'message', (event: MessageEvent<NetflixTracksMessage>) => {
    if (event.source !== window || event.data?.source !== NETFLIX_FROM_PAGE || event.data.type !== 'tracks') return;
    load(event.data).catch((error: unknown) => console.warn('Glossa: couldn’t load Netflix’s subtitles', error));
  });
  toPage({ source: NETFLIX_TO_PAGE, type: 'replay' });

  // Netflix draws its own subtitles over the video; hide them while Glossa shows a line.
  const style = document.createElement('style');
  style.textContent = '.player-timedtext { visibility: hidden !important; }';
  const hideOwnSubtitles = () => {
    const { settings, track } = store.get();
    if (settings.enabled && track) document.head.append(style);
    else style.remove();
  };
  ctx.onInvalidated(store.subscribe(hideOwnSubtitles));
  ctx.onInvalidated(() => style.remove());
}
