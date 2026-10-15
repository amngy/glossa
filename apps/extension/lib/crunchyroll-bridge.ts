/**
 * Protocol between the Crunchyroll page-context hook (MAIN world) and the video content script.
 * They share the page's `window`, so they talk with `window.postMessage`.
 */

export const CRUNCHYROLL_FROM_PAGE = 'glossa:crunchyroll-page';
export const CRUNCHYROLL_TO_PAGE = 'glossa:crunchyroll-extension';

/** The subtitle files the episode's `play` response lists, by locale ("en-US"), and the audio's locale. */
export interface CrunchyrollPlayMessage {
  source: typeof CRUNCHYROLL_FROM_PAGE;
  type: 'play';
  episode: string;
  audioLocale?: string;
  subtitles: { lang: string; url: string; format: string }[];
}

/** Re-send the episode now playing, for a content script that started after Crunchyroll asked for it. */
export interface CrunchyrollReplayMessage {
  source: typeof CRUNCHYROLL_TO_PAGE;
  type: 'replay';
}
