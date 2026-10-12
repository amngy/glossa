import { defineContentScript } from '#imports';
import { FROM_PAGE, TO_PAGE, type CaptionTrackInfo, type ExtensionMessage, type PageMessageBody } from '@/lib/youtube-bridge';

/**
 * Runs in YouTube's own JavaScript context (MAIN world) so it can:
 * - see the caption files YouTube's player downloads (they carry tokens we
 *   couldn't generate ourselves), and
 * - ask the player which caption tracks exist and switch tracks.
 * It only forwards data to Glossa's content script; all logic lives there.
 */

interface YouTubePlayer extends HTMLElement {
  getPlayerResponse?(): {
    videoDetails?: { videoId?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: {
          languageCode: string;
          kind?: string;
          vssId?: string;
          name?: { simpleText?: string; runs?: { text: string }[] };
        }[];
      };
    };
  };
  getVideoData?(): { video_id?: string };
  loadModule?(name: string): void;
  getOption?(module: string, option: string): unknown;
  setOption?(module: string, option: string, value: unknown): void;
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const MAX_REMEMBERED = 8;
    const captured: { url: string; body: string }[] = [];

    const post = (message: PageMessageBody) =>
      window.postMessage({ source: FROM_PAGE, ...message }, location.origin);

    const isTimedText = (url: string) => url.includes('/api/timedtext');

    function forward(rawUrl: string, body: string) {
      if (!body) return;
      const url = new URL(rawUrl, location.href).href;
      captured.push({ url, body });
      if (captured.length > MAX_REMEMBERED) captured.shift();
      post({ type: 'timedtext', url, body });
    }

    const originalFetch = window.fetch;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        if (isTimedText(url) && response.ok) {
          response.clone().text().then((body) => forward(url, body), () => {});
        }
      } catch {
        // Never break YouTube because of Glossa.
      }
      return response;
    };

    const requestUrls = new WeakMap<XMLHttpRequest, string>();
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      requestUrls.set(this, String(args[1]));
      return (originalOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
      const url = requestUrls.get(this);
      if (url && isTimedText(url)) {
        this.addEventListener('load', () => {
          try {
            if (this.status !== 200) return;
            if (this.responseType === '' || this.responseType === 'text') forward(url, this.responseText);
            else if (this.responseType === 'json') forward(url, JSON.stringify(this.response));
          } catch {
            // ignore
          }
        });
      }
      return originalSend.apply(this, args);
    };

    function player(): YouTubePlayer | null {
      return document.getElementById('movie_player') as YouTubePlayer | null;
    }

    function listTracks() {
      const p = player();
      const response = p?.getPlayerResponse?.();
      const raw = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const tracks: CaptionTrackInfo[] = raw.map((t) => ({
        languageCode: t.languageCode,
        name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text).join('') ?? t.languageCode,
        kind: t.kind,
        vssId: t.vssId,
      }));
      const videoId = response?.videoDetails?.videoId ?? p?.getVideoData?.()?.video_id ?? null;
      post({ type: 'tracks', videoId, tracks });
    }

    function loadTrack(track: CaptionTrackInfo) {
      const p = player();
      if (!p?.setOption) return;
      p.loadModule?.('captions');
      const available = p.getOption?.('captions', 'tracklist');
      const match = Array.isArray(available)
        ? (available as CaptionTrackInfo[]).find(
            (t) => t.languageCode === track.languageCode && (t.kind ?? '') === (track.kind ?? ''),
          )
        : undefined;
      p.setOption('captions', 'track', match ?? { languageCode: track.languageCode, kind: track.kind });
    }

    window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
      if (event.source !== window || event.data?.source !== TO_PAGE) return;
      switch (event.data.type) {
        case 'get-tracks':
          listTracks();
          break;
        case 'load-track':
          loadTrack(event.data.track);
          break;
        case 'replay':
          for (const { url, body } of captured) post({ type: 'timedtext', url, body });
          break;
      }
    });
  },
});
