import type { PrimeVideoSubtitle } from '@glossa/core';

/**
 * Protocol between the Prime Video page-context hook (MAIN world) and the video content script.
 * They share the page's `window`, so they talk with `window.postMessage`.
 */

export const PRIME_FROM_PAGE = 'glossa:prime-page';
export const PRIME_TO_PAGE = 'glossa:prime-extension';

/** The subtitle files (TTML) Prime Video lists for the title now playing. */
export interface PrimeSubtitlesMessage {
  source: typeof PRIME_FROM_PAGE;
  type: 'subtitles';
  title: string;
  subtitles: PrimeVideoSubtitle[];
}

/** Re-send the title now playing, for a content script that started after Prime Video listed it. */
export interface PrimeReplayMessage {
  source: typeof PRIME_TO_PAGE;
  type: 'replay';
}
