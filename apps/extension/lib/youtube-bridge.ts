/**
 * Protocol between the YouTube page-context hook (MAIN world) and the
 * extension's content script (isolated world). They share the page's
 * `window`, so they talk with `window.postMessage`.
 */

export const FROM_PAGE = 'glossa:youtube-page';
export const TO_PAGE = 'glossa:youtube-extension';

export interface CaptionTrackInfo {
  languageCode: string;
  /** Display name from YouTube, e.g. "Spanish (auto-generated)". */
  name: string;
  /** "asr" for automatic speech recognition tracks. */
  kind?: string;
  vssId?: string;
}

export type PageMessage =
  | { source: typeof FROM_PAGE; type: 'timedtext'; url: string; body: string }
  | { source: typeof FROM_PAGE; type: 'tracks'; videoId: string | null; tracks: CaptionTrackInfo[] };

export type ExtensionMessage =
  | { source: typeof TO_PAGE; type: 'get-tracks' }
  | { source: typeof TO_PAGE; type: 'load-track'; track: CaptionTrackInfo }
  /** Re-send captions captured before the content script was listening. */
  | { source: typeof TO_PAGE; type: 'replay' };

type WithoutSource<T> = T extends unknown ? Omit<T, 'source'> : never;
export type PageMessageBody = WithoutSource<PageMessage>;
export type ExtensionMessageBody = WithoutSource<ExtensionMessage>;

export function trackKey(track: { languageCode: string; kind?: string }): string {
  return `${track.languageCode}|${track.kind ?? ''}`;
}
