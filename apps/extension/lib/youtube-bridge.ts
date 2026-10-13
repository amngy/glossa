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
  | { source: typeof FROM_PAGE; type: 'tracks'; videoId: string | null; tracks: CaptionTrackInfo[] }
  /**
   * A copy of bytes the player appended to an audio SourceBuffer (#44). `buffer` numbers the
   * SourceBuffers in creation order, so each stream's init segment stays with its media segments.
   * `ad` and `dubbed` describe the player when the bytes were appended: an ad was showing, or the audio
   * track was YouTube's AI dub. `videoId` is the player's video then. `replayed` marks an init segment
   * sent again when the tap turned on.
   */
  | {
      source: typeof FROM_PAGE;
      type: 'audio-append';
      buffer: number;
      mime: string;
      timestampOffset: number;
      ad: boolean;
      dubbed: boolean;
      videoId?: string;
      replayed?: boolean;
      data: ArrayBuffer;
    };

export type ExtensionMessage =
  | { source: typeof TO_PAGE; type: 'get-tracks' }
  | { source: typeof TO_PAGE; type: 'load-track'; track: CaptionTrackInfo }
  /** Re-send captions captured before the content script was listening. */
  | { source: typeof TO_PAGE; type: 'replay' }
  /** Start or stop copying audio appends (look-ahead transcription). Off until asked. While on, the player is switched from an AI dub to the original audio. */
  | { source: typeof TO_PAGE; type: 'audio-tap'; on: boolean };

type WithoutSource<T> = T extends unknown ? Omit<T, 'source'> : never;
export type PageMessageBody = WithoutSource<PageMessage>;
export type ExtensionMessageBody = WithoutSource<ExtensionMessage>;

export function trackKey(track: { languageCode: string; kind?: string }): string {
  return `${track.languageCode}|${track.kind ?? ''}`;
}
