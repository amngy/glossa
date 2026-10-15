/**
 * Protocol between the Stremio Web page-context hook (MAIN world) and the video content script.
 * They share the page's `window`, so they talk with `window.postMessage`.
 */

export const STREMIO_FROM_PAGE = 'glossa:stremio-page';
export const STREMIO_TO_PAGE = 'glossa:stremio-extension';

/** A subtitle file Stremio downloaded, latest last. `lang` is its add-on's code ("eng", "jpn"), when Stremio listed it. */
export interface StremioSubtitleMessage {
  source: typeof STREMIO_FROM_PAGE;
  type: 'subtitle';
  url: string;
  lang?: string;
  body: string;
}

/** Re-send the files of the video now playing, for a content script that started after Stremio downloaded them. */
export interface StremioReplayMessage {
  source: typeof STREMIO_TO_PAGE;
  type: 'replay';
}
