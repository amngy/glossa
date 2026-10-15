import { primeVideoSubtitles } from '@glossa/core';
import { defineContentScript } from '#imports';
import { PRIME_FROM_PAGE, PRIME_TO_PAGE, type PrimeReplayMessage, type PrimeSubtitlesMessage } from '@/lib/prime-video-bridge';

/**
 * Runs in Prime Video's own JavaScript context (MAIN world) and reads the subtitle list from the player's
 * `GetVodPlaybackResources` response. If that response has none, it asks once more with the same request,
 * as asbplayer does (MIT, github.com/killergerbah/asbplayer). It only forwards the list to Glossa's
 * content script (entrypoints/video.content/prime-video.ts). Experimental: not yet checked on a live
 * account (#80).
 */
export default defineContentScript({
  // No `matches`: WXT would add the sites to the install-time permissions. lib/video-sites.ts registers it.
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const installed = Symbol.for('glossa.prime-video-hook');
    const page = window as unknown as Record<symbol, boolean>;
    if (page[installed]) return;
    page[installed] = true;

    let last: PrimeSubtitlesMessage | null = null;
    const asked = new Set<string>();
    const send = (message: PrimeSubtitlesMessage) => window.postMessage(message, location.origin);
    const originalFetch = window.fetch;

    function read(url: string, body: unknown, request: string | undefined): void {
      const title = new URL(url, location.href).searchParams.get('titleId');
      if (!title) return;
      const subtitles = primeVideoSubtitles(body);
      if (subtitles) {
        last = { source: PRIME_FROM_PAGE, type: 'subtitles', title, subtitles };
        send(last);
      } else if (request && !asked.has(title)) {
        asked.add(title);
        originalFetch(url, { method: 'POST', body: request, headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
          .then((response) => response.json())
          .then((again: unknown) => read(url, again, undefined), () => {});
      }
    }

    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      try {
        const [input, init] = args;
        const url = input instanceof Request ? input.url : String(input);
        if (response.ok && url.includes('GetVodPlaybackResources')) {
          const request = typeof init?.body === 'string' ? init.body : undefined;
          response.clone().json().then((body: unknown) => read(url, body, request), () => {});
        }
      } catch {
        // Never break Prime Video because of Glossa.
      }
      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const urls = new WeakMap<XMLHttpRequest, string>();
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      if (String(args[1]).includes('GetVodPlaybackResources')) urls.set(this, String(args[1]));
      return (originalOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const url = urls.get(this);
      if (url) {
        this.addEventListener('load', () => {
          try {
            const json: unknown = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            read(url, json, typeof body === 'string' ? body : undefined);
          } catch {
            // Never break Prime Video because of Glossa.
          }
        });
      }
      return originalSend.call(this, body);
    };

    window.addEventListener('message', (event: MessageEvent<PrimeReplayMessage>) => {
      if (event.source !== window || event.data?.source !== PRIME_TO_PAGE || event.data.type !== 'replay') return;
      if (last) send(last);
    });
  },
});
