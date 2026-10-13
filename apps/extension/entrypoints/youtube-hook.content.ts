import { defineContentScript } from '#imports';
import { FROM_PAGE, TO_PAGE, type CaptionTrackInfo, type ExtensionMessage, type PageMessageBody } from '@/lib/youtube-bridge';

/**
 * Runs in YouTube's own JavaScript context (MAIN world) so it can:
 * - see the caption files YouTube's player downloads (they carry tokens we
 *   couldn't generate ourselves),
 * - ask the player which caption tracks exist and switch tracks, and
 * - when asked, copy the audio the player appends to Media Source Extensions, which arrives
 *   seconds before it plays (look-ahead transcription, #44). No extra request: the player already
 *   fetched these bytes. MSE in a worker would bypass this hook; YouTube used the main thread
 *   when checked (2026-10-12).
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
  getAudioTrack?(): object;
  getAvailableAudioTracks?(): object[];
  setAudioTrack?(track: object): void;
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

    // Wrapped at document_start, before the player makes its SourceBuffers; copies only while the tap is on.
    let tapAudio = false;
    let sourceBuffers = 0;
    const audioBuffers = new WeakMap<SourceBuffer, { buffer: number; mime: string }>();
    /** The latest init segment (a few hundred bytes) of each audio buffer, sent again when the tap turns on. */
    const inits = new Map<number, Extract<PageMessageBody, { type: 'audio-append' }>>();
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
      const sourceBuffer = originalAddSourceBuffer.call(this, mime);
      if (mime.startsWith('audio/')) audioBuffers.set(sourceBuffer, { buffer: sourceBuffers++, mime });
      return sourceBuffer;
    };

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (this: SourceBuffer, data: BufferSource) {
      const audio = audioBuffers.get(this);
      if (audio) {
        try {
          const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
          const init = view[0] === 0x1a && view[1] === 0x45 && view[2] === 0xdf && view[3] === 0xa3;
          if (tapAudio || init) {
            const p = player();
            const message: Extract<PageMessageBody, { type: 'audio-append' }> = {
              type: 'audio-append',
              ...audio,
              timestampOffset: this.timestampOffset,
              // Each ad plays from its own MediaSource on the same video, so this marks the ad's appends.
              ad: !!p?.classList.contains('ad-showing'),
              dubbed: !!audioTrackInfo(p?.getAudioTrack?.())?.isAutoDubbed,
              videoId: p?.getVideoData?.()?.video_id,
              // Copied, because the player may reuse its buffer once the append is done.
              data: view.slice().buffer,
            };
            if (init) {
              inits.set(audio.buffer, message);
              if (inits.size > 16) inits.delete(inits.keys().next().value!);
            }
            if (tapAudio) {
              post(message);
              // Not during an ad: the player may not switch then, and it's tried once per video.
              if (message.dubbed && !message.ad && p) pickOriginalAudio(p);
            }
          }
        } catch {
          // Never break YouTube because of Glossa.
        }
      }
      return originalAppendBuffer.call(this, data);
    };

    /** The part of a player audio track that describes it; its property name is minified, so it's found by shape. */
    function audioTrackInfo(track: object | undefined): { name?: string; isAutoDubbed?: boolean } | undefined {
      for (const key in track) {
        const value = (track as Record<string, unknown>)[key];
        if (value && typeof value === 'object' && 'isAutoDubbed' in value) return value as { name?: string; isAutoDubbed?: boolean };
      }
      return undefined;
    }

    // YouTube may default to an AI-dubbed track; transcribing that would give the wrong language. Once per video.
    let pickedFor: string | undefined;
    function pickOriginalAudio(p: YouTubePlayer) {
      const video = p.getVideoData?.()?.video_id;
      if (video === pickedFor) return;
      pickedFor = video;
      const tracks = p.getAvailableAudioTracks?.() ?? [];
      const original =
        tracks.find((track) => /original/i.test(audioTrackInfo(track)?.name ?? '')) ??
        tracks.find((track) => audioTrackInfo(track)?.isAutoDubbed === false);
      // After the current append: switching makes a new MediaSource.
      if (original) setTimeout(() => p.setAudioTrack?.(original));
    }

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
        case 'audio-tap':
          // Streams already running are read from their init segment; the receiver resyncs at the next cluster.
          if (event.data.on && !tapAudio) for (const message of inits.values()) post({ ...message, replayed: true });
          tapAudio = event.data.on;
          break;
      }
    });
  },
});
