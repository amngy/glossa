import type { NetflixTextTrack } from '@glossa/core';

/**
 * Protocol between the Netflix page-context hook (MAIN world) and the video content script.
 * They share the page's `window`, so they talk with `window.postMessage`.
 */

export const NETFLIX_FROM_PAGE = 'glossa:netflix-page';
export const NETFLIX_TO_PAGE = 'glossa:netflix-extension';

/** The WebVTT subtitle files Netflix's manifest lists for the title now playing, and the audio's language. */
export interface NetflixTracksMessage {
  source: typeof NETFLIX_FROM_PAGE;
  type: 'tracks';
  movie: string;
  audio?: string;
  tracks: NetflixTextTrack[];
}

/** Re-send the title now playing (`replay`), or seek Netflix's player, which breaks when `video.currentTime` is set. */
export type NetflixToPageMessage =
  | { source: typeof NETFLIX_TO_PAGE; type: 'replay' }
  | { source: typeof NETFLIX_TO_PAGE; type: 'seek'; seconds: number };
