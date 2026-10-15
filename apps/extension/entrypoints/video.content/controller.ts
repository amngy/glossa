import {
  baseLanguage,
  cleanCueText,
  languageName,
  mergeOverlappingCues,
  type Cue,
  type SubtitleTrack,
} from '@glossa/core';
import { fallbackLanguage, sampleText, SubtitleController, TRANSCRIPT_KEY } from '@/components/overlay/controller';
import type { TrackOption, VideoBox } from '@/components/overlay/state';
import { detectLanguage } from '@/lib/detect-language';

/** `TrackOption.key` of a subtitle file the viewer loaded. */
const FILE_KEY = 'file';

/** A subtitle file the viewer loaded, or one the site downloaded (Stremio Web). `guessed`: its language is a guess. */
interface SubtitleFile {
  key: string;
  track: SubtitleTrack;
  guessed: boolean;
  /** Where the site downloaded it from. */
  url?: string;
}

/** Smaller videos are previews, thumbnails or ads rather than something to watch with subtitles. */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 110;
const SCAN_INTERVAL_MS = 1000;
/** The toolbar stays this long after the mouse last moved over the video. */
const POINTER_IDLE_MS = 2500;
/** How long a track may take to load its lines before Glossa gives up on it. */
const CUE_WAIT_MS = 6000;

/** Room for the player's own controls below the subtitles. Every site draws them differently, so this is a guess. */
function controlsAllowance(height: number): number {
  return Math.round(Math.max(64, height * 0.12));
}

function isSubtitleTrack(track: TextTrack): boolean {
  return track.kind === 'subtitles' || track.kind === 'captions';
}

function trackName(track: TextTrack, index: number): string {
  return track.label || (track.language ? languageName(track.language) : `Subtitles ${index + 1}`);
}

function readCues(track: TextTrack): Cue[] {
  const list = track.cues;
  if (!list) return [];
  const cues: Cue[] = [];
  for (let i = 0; i < list.length; i++) {
    const cue = list[i];
    // Only VTTCues have text; other cue types carry data for scripts.
    if (!cue || !('text' in cue)) continue;
    const text = cleanCueText(String(cue.text));
    if (text) cues.push({ start: cue.startTime, end: cue.endTime, text });
  }
  return mergeOverlappingCues(cues.sort((a, b) => a.start - b.start));
}

function isLargeEnough(video: HTMLVideoElement): boolean {
  if (!video.isConnected) return false;
  const box = video.getBoundingClientRect();
  return box.width >= MIN_WIDTH && box.height >= MIN_HEIGHT;
}

function area(video: HTMLVideoElement): number {
  const box = video.getBoundingClientRect();
  return box.width * box.height;
}

function findVideos(): HTMLVideoElement[] {
  const videos = [...document.querySelectorAll('video')];
  if (videos.length > 0) return videos;
  // Some players keep their video inside a shadow root.
  const found: HTMLVideoElement[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll('*')) {
      if (!element.shadowRoot) continue;
      found.push(...element.shadowRoot.querySelectorAll('video'));
      walk(element.shadowRoot);
    }
  };
  walk(document);
  return found;
}

function sameBox(a: VideoBox | undefined, b: VideoBox): boolean {
  return !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Shows Glossa over any HTML5 video: follows the largest playing video on the page and
 * reads its <track> subtitles, or a subtitle file the viewer loads.
 */
export class VideoController extends SubtitleController {
  private boundVideo: HTMLVideoElement | null = null;
  /** Aborts the listeners on `boundVideo`. */
  private binding: AbortController | null = null;
  private lastScan = -Infinity;
  private pointerUntil = 0;

  private textTracks: TextTrack[] = [];
  private readonly trackKeys = new WeakMap<TextTrack, string>();
  private trackKeyCount = 0;
  /** The viewer's corrections of track languages. */
  private readonly languageOverrides = new WeakMap<TextTrack, string>();
  /** Modes of the tracks Glossa changed, to put back when it stops. */
  private readonly originalModes = new Map<TextTrack, TextTrackMode>();

  /** The page's track being shown, if it isn't a file. */
  private primary: TextTrack | null = null;
  private primaryCueCount = -1;
  private primaryWaitStart = 0;
  private installing = false;
  /** A page track in the native language, used as the translation. */
  private translationSource: TextTrack | null = null;
  private translationCueCount = -1;
  private translationWaitStart = 0;
  private files: SubtitleFile[] = [];
  private siteFileCount = 0;

  /** In the video element's own fullscreen nothing can be drawn over it, so the browser shows the subtitles. */
  private nativeFallback = false;
  private fallbackTrack: TextTrack | null = null;

  /** How many videos Glossa found when it started, for the popup. */
  videoCount(): number {
    return this.boundVideo ? 1 : 0;
  }

  protected onStart(): void {
    this.store.set({ canLoadFile: true });
    this.ctx.addEventListener(
      window,
      'pointermove',
      (event) => {
        const video = this.boundVideo;
        if (!video) return;
        const box = video.getBoundingClientRect();
        const { clientX: x, clientY: y } = event as PointerEvent;
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          this.pointerUntil = performance.now() + POINTER_IDLE_MS;
        }
      },
      { capture: true, passive: true },
    );
    this.ctx.addEventListener(document, 'fullscreenchange', () => this.updateNativeFallback());
    this.ctx.onInvalidated(() => {
      this.setNativeFallback(false);
      this.binding?.abort();
      this.restoreModes();
    });
    this.scan();
  }

  // ----------------------------------------------------------------- videos

  protected updateFrame(): HTMLVideoElement | null {
    const now = performance.now();
    if (now - this.lastScan > SCAN_INTERVAL_MS) {
      this.lastScan = now;
      this.scan();
    }
    const video = this.boundVideo;
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    const box = { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
    const fullscreen = document.fullscreenElement;
    const drawable = !fullscreen || (fullscreen !== video && fullscreen.contains(video));
    const state = this.store.get();
    this.store.set({
      active: drawable && box.width > 0 && box.height > 0,
      box: sameBox(state.box, box) ? state.box : box,
      playerHeight: box.height,
      controlsHeight: controlsAllowance(box.height),
      controlsVisible: now < this.pointerUntil,
    });

    this.syncPrimary(now);
    this.syncTranslation(now);
    return video;
  }

  /** Picks the video to follow: the current one while it's still shown, else the largest playing one. */
  private scan(): void {
    const candidates = findVideos().filter(isLargeEnough);
    const largest = (videos: HTMLVideoElement[]) => videos.sort((a, b) => area(b) - area(a))[0] ?? null;
    const playing = largest(candidates.filter((video) => !video.paused));
    const current = this.boundVideo;
    if (current && candidates.includes(current)) {
      // While paused (say, for a word card) the video keeps the subtitles, unless a bigger one starts playing.
      if (current.paused && playing && area(playing) > area(current)) this.bindVideo(playing);
      return;
    }
    const next = playing ?? largest(candidates);
    // A video that's briefly hidden or resized (entering fullscreen, say) keeps its subtitles.
    if (!next && current?.isConnected) return;
    if (next !== current) this.bindVideo(next);
  }

  private bindVideo(video: HTMLVideoElement | null): void {
    this.setNativeFallback(false);
    this.binding?.abort();
    this.binding = null;
    this.restoreModes();
    this.boundVideo = video;
    this.textTracks = [];
    this.primary = null;
    this.translationSource = null;
    this.translationTrackPending = false;
    // The site's files stay: Stremio downloads them before the video loads.
    this.files = this.files.filter((file) => file.key !== FILE_KEY);
    this.fallbackTrack = null;
    this.clearTranscript();
    this.setTrack(undefined, {
      active: !!video,
      status: video ? 'loading' : 'idle',
      tracks: [],
      trackKey: null,
      languageGuessed: false,
      box: undefined,
    });
    if (!video) return;

    const binding = new AbortController();
    this.binding = binding;
    const { signal } = binding;
    let source = video.currentSrc;
    // A new source (the next episode, say) brings its own tracks.
    video.addEventListener(
      'loadstart',
      () => {
        if (video.currentSrc !== source) {
          source = video.currentSrc;
          this.bindVideo(video);
        }
      },
      { signal },
    );
    video.textTracks.addEventListener('addtrack', () => this.refreshTracks(), { signal });
    video.textTracks.addEventListener('removetrack', () => this.refreshTracks(), { signal });
    video.textTracks.addEventListener('change', () => this.onModesChanged(), { signal });
    this.refreshTracks();
  }

  // ----------------------------------------------------------------- tracks

  private keyFor(track: TextTrack): string {
    let key = this.trackKeys.get(track);
    if (!key) {
      key = `track-${++this.trackKeyCount}`;
      this.trackKeys.set(track, key);
    }
    return key;
  }

  private refreshTracks(): void {
    const video = this.boundVideo;
    if (!video) return;
    this.textTracks = [...video.textTracks].filter((t) => isSubtitleTrack(t) && t !== this.fallbackTrack);
    const options: TrackOption[] = this.textTracks.map((t, i) => ({ key: this.keyFor(t), name: trackName(t, i) }));
    for (const file of this.files) options.push({ key: file.key, name: file.track.label ?? 'Subtitle file' });
    const transcript = this.transcriptOption();
    if (transcript) options.push(transcript);
    this.store.set({ tracks: options });

    const { trackKey, settings } = this.store.get();
    if (trackKey && options.some((option) => option.key === trackKey)) {
      this.chooseTranslationSource();
      return;
    }
    const native = baseLanguage(settings.nativeLanguage);
    if (this.textTracks.length === 0) {
      this.primary = null;
      // The latest file not in the viewer's own language.
      const file = this.files.findLast((f) => baseLanguage(f.track.lang) !== native) ?? this.files.at(-1);
      if (file) this.useFile(file.key);
      else if (!this.transcript) this.setTrack(undefined, { status: 'no-subtitles', trackKey: null, languageGuessed: false });
      return;
    }
    // The track the site shows, unless it's in the viewer's own language; then one in another language.
    const isForeign = (t: TextTrack) => !t.language || baseLanguage(t.language) !== native;
    const showing = this.textTracks.find((t) => t.mode === 'showing');
    const pick = (showing && isForeign(showing) ? showing : undefined) ?? this.textTracks.find(isForeign) ?? this.textTracks[0]!;
    this.useTextTrack(pick);
  }

  selectTrack(key: string): void {
    if (key === TRANSCRIPT_KEY) {
      this.primary = null;
      this.showTranscript();
      return;
    }
    if (this.files.some((file) => file.key === key)) {
      this.useFile(key);
      return;
    }
    const track = this.textTracks.find((t) => this.keyFor(t) === key);
    if (track) this.useTextTrack(track);
  }

  private useTextTrack(track: TextTrack): void {
    this.setNativeFallback(false);
    this.primary = track;
    this.primaryCueCount = -1;
    this.primaryWaitStart = performance.now();
    if (this.store.get().settings.enabled) this.hideNative(track);
    this.setTrack(undefined, { status: 'loading', trackKey: this.keyFor(track), languageGuessed: false });
    this.chooseTranslationSource();
    this.updateNativeFallback();
  }

  /** Follows the lines of the page's track; players often add them as the video loads. */
  private syncPrimary(now: number): void {
    const track = this.primary;
    if (!track || this.installing) return;
    const count = track.cues?.length ?? 0;
    if (count === this.primaryCueCount) {
      const { track: shown, status } = this.store.get();
      if (!shown && status === 'loading' && now - this.primaryWaitStart > CUE_WAIT_MS) {
        this.store.set({
          status: 'error',
          error: 'Couldn’t read this subtitle track. Try another one, or load a subtitle file.',
        });
      }
      return;
    }
    this.primaryCueCount = count;
    const cues = readCues(track);
    if (this.store.get().track) this.extendTrack(cues);
    else if (cues.length > 0) void this.installTextTrack(track, cues);
  }

  private async installTextTrack(track: TextTrack, cues: Cue[]): Promise<void> {
    this.installing = true;
    try {
      const known = this.languageOverrides.get(track) ?? track.language;
      const lang = known || (await detectLanguage(sampleText(cues))) || fallbackLanguage();
      if (this.primary !== track) return;
      const current = readCues(track);
      this.primaryCueCount = track.cues?.length ?? 0;
      this.setTrack(
        { lang, label: track.label || undefined, cues: current },
        { trackKey: this.keyFor(track), languageGuessed: !track.language || this.languageOverrides.has(track) },
      );
      this.chooseTranslationSource();
    } finally {
      this.installing = false;
    }
  }

  /** Uses a page track or file in the viewer's language, if there is one, as the translation. */
  private chooseTranslationSource(): void {
    const { settings, track, trackKey } = this.store.get();
    const native = baseLanguage(settings.nativeLanguage);
    const lang = track?.lang ?? this.primary?.language;
    const ownLanguage = !!lang && baseLanguage(lang) === native;
    const source = ownLanguage
      ? null
      : (this.textTracks.find((t) => t !== this.primary && t.language && baseLanguage(t.language) === native) ?? null);
    const file = ownLanguage || source ? undefined : this.files.findLast((f) => f.key !== trackKey && baseLanguage(f.track.lang) === native);
    this.translationCueCount = -1;
    this.translationWaitStart = performance.now();
    this.translationSource = source;
    // Until it's known whether the track covers a line, don't translate lines one by one.
    this.translationTrackPending = !!source;
    if (source && this.store.get().settings.enabled) this.hideNative(source);
    if (!source) this.store.set({ translationTrack: file?.track });
  }

  private syncTranslation(now: number): void {
    const source = this.translationSource;
    const { track, displayIndex } = this.store.get();
    if (!source || !track) return;
    const count = source.cues?.length ?? 0;
    if (count !== this.translationCueCount) {
      this.translationCueCount = count;
      const cues = readCues(source);
      if (cues.length > 0) this.store.set({ translationTrack: { lang: source.language, cues } });
    }
    const ready = this.store.get().translationTrack !== undefined || now - this.translationWaitStart > CUE_WAIT_MS;
    if (this.translationTrackPending && ready) {
      this.translationTrackPending = false;
      this.translateAround(displayIndex);
    }
  }

  // ------------------------------------------------------------------ files

  override loadFile(file: File): void {
    void this.readFile(file);
  }

  private async readFile(file: File): Promise<void> {
    const track = await this.readSubtitleFile(file);
    if (!track) return;
    this.files = [...this.files.filter((f) => f.key !== FILE_KEY), { key: FILE_KEY, track, guessed: true }];
    this.useFile(FILE_KEY);
    this.refreshTracks();
  }

  /** Adds a subtitle file the site downloaded. Unless it's in the viewer's own language, it's the one the viewer picked there, so it's shown. */
  addSiteFile(url: string, track: SubtitleTrack, guessed: boolean): void {
    const native = baseLanguage(this.store.get().settings.nativeLanguage);
    const key = `site-${++this.siteFileCount}`;
    // The same file again (picked again) replaces the old copy.
    this.files = [...this.files.filter((f) => f.url !== url), { key, track, guessed, url }];
    if (baseLanguage(track.lang) !== native || !this.store.get().track) this.useFile(key);
    // Otherwise it becomes the translation, if it fits.
    this.refreshTracks();
  }

  /** Forgets the site's files, e.g. when another video opens. */
  clearSiteFiles(): void {
    const { trackKey } = this.store.get();
    this.files = this.files.filter((f) => f.key === FILE_KEY);
    if (trackKey?.startsWith('site-')) this.setTrack(undefined, { trackKey: null });
    this.refreshTracks();
  }

  protected override onTranscriptionStart(): void {
    this.refreshTracks();
    this.setNativeFallback(false);
    this.primary = null;
  }

  private useFile(key: string): void {
    const file = this.files.find((f) => f.key === key);
    if (!file) return;
    this.setNativeFallback(false);
    this.primary = null;
    // A file's language may be a guess from its name or text; then the viewer can correct it.
    this.setTrack(file.track, { trackKey: key, languageGuessed: file.guessed });
    this.chooseTranslationSource();
    this.updateNativeFallback();
  }

  override setTrackLanguage(lang: string): void {
    const { track, trackKey } = this.store.get();
    if (!track) return;
    const next = { ...track, lang };
    const file = this.files.find((f) => f.key === trackKey);
    if (file) file.track = next;
    else if (this.primary) this.languageOverrides.set(this.primary, lang);
    this.setTrack(next, { trackKey, languageGuessed: true });
    this.chooseTranslationSource();
  }

  // ------------------------------------------------------ the page's own captions

  /** Stops the browser from drawing a track, while still loading its lines. */
  private hideNative(track: TextTrack): void {
    if (!this.originalModes.has(track)) this.originalModes.set(track, track.mode);
    if (track.mode !== 'hidden') track.mode = 'hidden';
  }

  private restoreModes(): void {
    for (const [track, mode] of this.originalModes) track.mode = mode;
    this.originalModes.clear();
  }

  /** The viewer turned on captions in the site's own menu: show that track in Glossa instead. */
  private onModesChanged(): void {
    if (this.nativeFallback || !this.store.get().settings.enabled) return;
    const showing = this.textTracks.find((t) => t.mode === 'showing');
    if (!showing) return;
    if (showing === this.primary || showing === this.translationSource) this.hideNative(showing);
    else this.useTextTrack(showing);
  }

  protected override onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.setNativeFallback(false);
      this.restoreModes();
      return;
    }
    if (this.primary) this.hideNative(this.primary);
    if (this.translationSource) this.hideNative(this.translationSource);
    this.updateNativeFallback();
  }

  protected override onNativeLanguageChanged(): void {
    this.chooseTranslationSource();
    super.onNativeLanguageChanged();
  }

  private updateNativeFallback(): void {
    const video = this.boundVideo;
    this.setNativeFallback(!!video && document.fullscreenElement === video && this.store.get().settings.enabled);
  }

  /** In the video's own fullscreen, lets the browser draw the subtitles (without Glossa's clickable words). */
  private setNativeFallback(on: boolean): void {
    if (on === this.nativeFallback) return;
    this.nativeFallback = on;
    const video = this.boundVideo;
    const { track } = this.store.get();
    if (on) {
      if (this.primary) this.primary.mode = 'showing';
      else if (video && track) {
        this.fallbackTrack ??= video.addTextTrack('subtitles', 'Glossa', track.lang);
        const fallback = this.fallbackTrack;
        fallback.mode = 'hidden';
        for (const cue of [...(fallback.cues ?? [])]) fallback.removeCue(cue);
        for (const cue of track.cues) fallback.addCue(new VTTCue(cue.start, cue.end, cue.text));
        fallback.mode = 'showing';
      }
    } else {
      if (this.primary?.mode === 'showing') this.primary.mode = 'hidden';
      if (this.fallbackTrack) this.fallbackTrack.mode = 'disabled';
    }
  }

  protected source(): { url: string; title: string } {
    return { url: location.href.replace(/#.*$/, ''), title: document.title };
  }
}
