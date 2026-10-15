import { defineContentScript } from '#imports';
import {
  CRUNCHYROLL_FROM_PAGE,
  CRUNCHYROLL_TO_PAGE,
  type CrunchyrollPlayMessage,
  type CrunchyrollReplayMessage,
} from '@/lib/crunchyroll-bridge';

/**
 * Runs in Crunchyroll's own JavaScript context (MAIN world) and reads the episode's `play` response,
 * which lists its subtitle files. It only forwards that list to Glossa's content script
 * (entrypoints/video.content/crunchyroll.ts), which downloads the one it needs. Registered at
 * document_start for the viewer's "Always on" site (lib/video-sites.ts), or injected by the popup.
 */
export default defineContentScript({
  // No `matches`: WXT would add crunchyroll.com to the install-time permissions. lib/video-sites.ts registers it.
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const installed = Symbol.for('glossa.crunchyroll-hook');
    const page = window as unknown as Record<symbol, boolean>;
    if (page[installed]) return;
    page[installed] = true;

    let last: CrunchyrollPlayMessage | null = null;
    const send = (message: CrunchyrollPlayMessage) => window.postMessage(message, location.origin);

    const originalFetch = window.fetch;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        // "/playback/v3/<episode>/web/chrome/play"
        const episode = /^\/playback\/v\d+\/([^/]+)\/.*\/play$/.exec(url.pathname)?.[1];
        if (response.ok && episode) {
          response
            .clone()
            .json()
            .then((body: { audioLocale?: unknown; subtitles?: Record<string, { url?: unknown; format?: unknown }> }) => {
              const subtitles = Object.entries(body.subtitles ?? {}).flatMap(([lang, file]) =>
                typeof file?.url === 'string' ? [{ lang, url: file.url, format: String(file.format ?? '') }] : [],
              );
              const audioLocale = typeof body.audioLocale === 'string' ? body.audioLocale : undefined;
              last = { source: CRUNCHYROLL_FROM_PAGE, type: 'play', episode, audioLocale, subtitles };
              send(last);
            }, () => {});
        }
      } catch {
        // Never break Crunchyroll because of Glossa.
      }
      return response;
    };

    window.addEventListener('message', (event: MessageEvent<CrunchyrollReplayMessage>) => {
      if (event.source !== window || event.data?.source !== CRUNCHYROLL_TO_PAGE || event.data.type !== 'replay') return;
      if (last) send(last);
    });
  },
});
