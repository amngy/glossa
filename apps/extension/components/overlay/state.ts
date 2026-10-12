import type { DictionaryEntry, SubtitleTrack } from '@glossa/core';
import type { Settings } from '@/lib/settings';

export type Async<T> =
  | { state: 'idle' }
  | { state: 'loading'; message?: string }
  | { state: 'done'; value: T }
  | { state: 'error'; message: string };

/**
 * A line's fallback translation. "needs-click" means the built-in browser
 * translator must download a language pack first, which browsers only
 * allow after a click.
 */
export type LineTranslation = Async<string> | { state: 'needs-click' };

/** Where to draw a card, in pixels relative to the subtitle box. */
export interface CardAnchor {
  /** Horizontal center of the clicked element. */
  x: number;
  /** Top edge of the clicked element. */
  top: number;
  boxHeight: number;
  /** Allowed horizontal range, so the card stays inside the player. */
  minX: number;
  maxX: number;
  /** Bottom edge of the clicked element. */
  bottom: number;
  /** Room between the clicked element and the top of the player. */
  spaceAbove: number;
  /** Room between the clicked element and the bottom of the player. */
  spaceBelow: number;
}

export interface CardState {
  id: number;
  kind: 'word' | 'sentence';
  /** Empty for sentence cards. */
  word: string;
  cueIndex: number;
  sentence: string;
  lang: string;
  anchor: CardAnchor;
  translation: Async<string>;
  entries: Async<DictionaryEntry[]>;
  /** The viewer asked their AI model for the definition after the dictionary had none. */
  aiLookup?: boolean;
  explanation: Async<string>;
  /** Why Listen did nothing, e.g. no voice for the language. */
  speechError?: string;
}

/** A subtitle track the viewer can pick in the toolbar. */
export interface TrackOption {
  key: string;
  name: string;
}

/** The video's position in the viewport, for overlays that aren't placed inside the site's player. */
export interface VideoBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OverlayState {
  settings: Settings;
  /** There's a video to show subtitles over (on YouTube: a watch page). */
  active: boolean;
  status: 'idle' | 'loading' | 'ready' | 'no-subtitles' | 'error';
  error?: string;
  /** Shown in the toolbar in place of the status, e.g. while speech is being recognised. */
  notice?: string;
  /** Subtitle tracks the site offers for the current video. */
  tracks: TrackOption[];
  trackKey: string | null;
  track?: SubtitleTrack;
  /** A translation of `track` into the native language (on YouTube, its machine translation), when available. */
  translationTrack?: SubtitleTrack;
  /** The track's language was guessed, so the toolbar lets the viewer correct it. */
  languageGuessed: boolean;
  /** The viewer can load a subtitle file from their computer. */
  canLoadFile: boolean;
  /** Unset when the overlay fills its host (YouTube's player). */
  box?: VideoBox;
  /** Index into `track.cues` of the line on screen, or -1. */
  displayIndex: number;
  lineTranslations: ReadonlyMap<number, LineTranslation>;
  /** Whether the player's controls are showing (or the mouse is over the video); this reveals the toolbar. */
  controlsVisible: boolean;
  /**
   * Pixels from the bottom of the player to the top of its control bar.
   * The bar catches the mouse even while it's hidden, so the subtitles sit above it.
   */
  controlsHeight: number;
  /** The mouse is over the subtitles (with a short grace period after it leaves). */
  hovering: boolean;
  adShowing: boolean;
  playerHeight: number;
  card?: CardState;
  /** `vocabKey`s of saved words, for highlighting. */
  savedKeys: ReadonlySet<string>;
  /** `vocabKey`s of words marked as known: never highlighted. */
  knownKeys: ReadonlySet<string>;
  browserTranslatorMissing: boolean;
}

export function initialState(settings: Settings): OverlayState {
  return {
    settings,
    active: false,
    languageGuessed: false,
    canLoadFile: false,
    status: 'idle',
    tracks: [],
    trackKey: null,
    displayIndex: -1,
    lineTranslations: new Map(),
    controlsVisible: false,
    controlsHeight: 0,
    hovering: false,
    adShowing: false,
    playerHeight: 480,
    savedKeys: new Set(),
    knownKeys: new Set(),
    browserTranslatorMissing: false,
  };
}
