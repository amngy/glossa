import { addNetflixWebVtt, netflixTextTracks } from '@glossa/core';
import { defineContentScript } from '#imports';
import { NETFLIX_FROM_PAGE, NETFLIX_TO_PAGE, type NetflixToPageMessage, type NetflixTracksMessage } from '@/lib/netflix-bridge';

interface NetflixPlayer {
  seek(ms: number): void;
  getAudioTrack?(): { bcp47?: string } | undefined;
}

/**
 * Runs in Netflix's own JavaScript context (MAIN world). It asks the manifest for WebVTT subtitles
 * and forwards the file list for the title now playing to Glossa's content script
 * (entrypoints/video.content/netflix.ts), which downloads the ones it needs. The approach follows
 * subadub (MIT, github.com/rsimmons/subadub); the manifest logic is in packages/core/src/subtitles/netflix.ts.
 * Experimental: nobody has checked it on a live account yet (#9).
 */
export default defineContentScript({
  // No `matches`: WXT would add netflix.com to the install-time permissions. lib/video-sites.ts registers it.
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const installed = Symbol.for('glossa.netflix-hook');
    const page = window as unknown as Record<symbol, boolean> & { netflix?: any };
    if (page[installed]) return;
    page[installed] = true;

    // By movie ID: Netflix loads the next episode's manifest before it starts.
    const tracksByMovie = new Map<string, NetflixTracksMessage['tracks']>();
    let last: NetflixTracksMessage | null = null;

    const player = (): NetflixPlayer | undefined => {
      try {
        const videoPlayer = page.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
        const id = videoPlayer?.getAllPlayerSessionIds?.().at(-1);
        return id === undefined ? undefined : videoPlayer.getVideoPlayerBySessionId(id);
      } catch {
        return undefined;
      }
    };

    const originalStringify = JSON.stringify;
    JSON.stringify = function (this: unknown, ...args: Parameters<typeof JSON.stringify>) {
      try {
        addNetflixWebVtt(args[0]);
      } catch {
        // Never break Netflix because of Glossa.
      }
      return originalStringify.apply(this, args);
    } as typeof JSON.stringify;

    const originalParse = JSON.parse;
    JSON.parse = function (this: unknown, ...args: Parameters<typeof JSON.parse>) {
      const value = originalParse.apply(this, args);
      try {
        const manifest = netflixTextTracks(value);
        if (manifest) {
          tracksByMovie.set(manifest.movie, manifest.tracks);
          check();
        }
      } catch {
        // Never break Netflix because of Glossa.
      }
      return value;
    } as typeof JSON.parse;

    const send = (message: NetflixTracksMessage) => window.postMessage(message, location.origin);

    // Sends the tracks for the title in the address bar, again when the audio language becomes known or changes.
    function check(): void {
      const movie = /\/watch\/(\d+)/.exec(location.pathname)?.[1];
      const tracks = movie && tracksByMovie.get(movie);
      if (!movie || !tracks) return;
      const audio = player()?.getAudioTrack?.()?.bcp47;
      if (last?.movie === movie && last.audio === audio) return;
      last = { source: NETFLIX_FROM_PAGE, type: 'tracks', movie, audio, tracks };
      send(last);
    }
    setInterval(check, 1000);

    window.addEventListener('message', (event: MessageEvent<NetflixToPageMessage>) => {
      if (event.source !== window || event.data?.source !== NETFLIX_TO_PAGE) return;
      if (event.data.type === 'replay' && last) send(last);
      if (event.data.type === 'seek') player()?.seek(Math.round(event.data.seconds * 1000));
    });
  },
});
