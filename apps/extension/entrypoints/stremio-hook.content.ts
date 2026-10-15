import { defineContentScript } from '#imports';
import { STREMIO_FROM_PAGE, STREMIO_TO_PAGE, type StremioReplayMessage, type StremioSubtitleMessage } from '@/lib/stremio-bridge';

/**
 * Runs in Stremio Web's own JavaScript context (MAIN world) and copies the subtitle files Stremio's
 * player downloads, so Glossa makes no requests of its own. The player fetches them on the main thread;
 * the list with their languages comes from Stremio's core, which runs in a Web Worker and posts its
 * player state back to the page. Registered at document_start for the viewer's "Always on" site
 * (lib/video-sites.ts), or injected by the popup, which is too late to see the worker start. It only
 * forwards data to Glossa's content script (entrypoints/video.content/stremio.ts).
 */
export default defineContentScript({
  // No `matches`: WXT would add web.stremio.com to the install-time permissions. lib/video-sites.ts registers it.
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // The popup may inject it into a page where it's already registered.
    const installed = Symbol.for('glossa.stremio-hook');
    const page = window as unknown as Record<symbol, boolean>;
    if (page[installed]) return;
    page[installed] = true;

    const MAX_FILES = 8;
    const MAX_LANGUAGES = 2000;
    /** Add-on language codes of the subtitles Stremio listed, by URL. */
    const languages = new Map<string, string>();
    /** Downloaded files, with the player route (location.hash) they were downloaded on. */
    const files: { hash: string; message: StremioSubtitleMessage }[] = [];

    const send = (message: StremioSubtitleMessage) => window.postMessage(message, location.origin);

    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener('message', (event: MessageEvent) => {
          try {
            // The core's player state: { response: { result: { data: { subtitles: [{ lang, url, … }] } } } }.
            const list: unknown = event.data?.response?.result?.data?.subtitles;
            if (!Array.isArray(list)) return;
            for (const entry of list as { url?: unknown; lang?: unknown }[]) {
              if (typeof entry?.url !== 'string' || typeof entry.lang !== 'string') continue;
              languages.set(new URL(entry.url).href, entry.lang);
              if (languages.size > MAX_LANGUAGES) languages.delete(languages.keys().next().value!);
            }
          } catch {
            // Never break Stremio because of Glossa.
          }
        });
      }
    };

    function keep(url: string, body: string) {
      if (!body.trim()) return;
      const message: StremioSubtitleMessage = { source: STREMIO_FROM_PAGE, type: 'subtitle', url, lang: languages.get(url), body };
      files.push({ hash: location.hash, message });
      if (files.length > MAX_FILES) files.shift();
      send(message);
    }

    const originalFetch = window.fetch;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = new URL(input instanceof Request ? input.url : String(input), location.href).href;
        if (response.ok && (languages.has(url) || /subrip|text\/vtt/i.test(response.headers.get('content-type') ?? ''))) {
          response.clone().text().then((body) => keep(url, body), () => {});
        }
      } catch {
        // Never break Stremio because of Glossa.
      }
      return response;
    };

    window.addEventListener('message', (event: MessageEvent<StremioReplayMessage>) => {
      if (event.source !== window || event.data?.source !== STREMIO_TO_PAGE || event.data.type !== 'replay') return;
      for (const file of files) if (file.hash === location.hash) send(file.message);
    });
  },
});
