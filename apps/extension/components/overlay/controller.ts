import type { ContentScriptContext } from '#imports';
import {
  BrowserTranslator,
  baseLanguage,
  findActiveCueIndex,
  findBestOverlap,
  findCueIndexAtOrBefore,
  isBrowserTranslatorSupported,
  languageFromFileName,
  languageName,
  parseTextSubtitles,
  subtitleContext,
  type Cue,
  type ExplainRequest,
  type SubtitleTrack,
  type TranslationRequest,
} from '@glossa/core';
import { detectLanguage } from '@/lib/detect-language';
import { sendMessage } from '@/lib/messages';
import { speak as speakAloud } from '@/lib/speech';
import { MAX_SUBTITLE_POSITION, updateSettings, watchSettings, type Settings, type TranslationDisplay } from '@/lib/settings';
import type { Store } from '@/lib/store';
import { getVocab, saveWord, vocabKey, watchVocab } from '@/lib/vocab-store';
import type { CardAnchor, CardState, LineTranslation, OverlayState } from './state';

const TRANSLATION_DISPLAY_ORDER: TranslationDisplay[] = ['show', 'blur', 'hide'];
/** While paused, keep showing a line this many seconds after it ends. */
const LINGER_SECONDS = 2;
/** Auto-pause fires this many seconds before a line ends, so the last word isn't cut off by the next line. */
const AUTO_PAUSE_LEAD = 0.15;
/** How long the mouse can be off the subtitles (say, crossing to the toolbar) before they count as left. */
const HOVER_GRACE_MS = 300;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A sample of a track's text for language detection. */
export function sampleText(cues: Cue[]): string {
  return cues
    .slice(0, 40)
    .map((cue) => cue.text)
    .join('\n');
}

/** Last resort when nothing says which language a track is in; the viewer can correct it. */
export function fallbackLanguage(): string {
  return baseLanguage(document.documentElement.lang || navigator.language || 'en');
}

/**
 * Connects a site's video to the overlay: follows playback and handles the viewer's actions.
 * Subclasses find the video and its subtitles; see YouTubeController and VideoController.
 */
export abstract class SubtitleController {
  protected video: HTMLVideoElement | null = null;
  protected autoPausedIndex = -1;
  /** Set while a translated track is loading, so lines aren't translated one by one meanwhile. */
  protected translationTrackPending = false;
  /**
   * Changes whenever `setTrack` installs a different track, so late translations for the old one are dropped.
   * `extendTrack` keeps it, since the lines translated so far stay where they are.
   */
  private trackGeneration = 0;
  private hoverEndTimer: number | undefined;
  private pausedByHover = false;
  private resumeAfterCard = false;
  private cardSequence = 0;
  private readonly browserTranslator = new BrowserTranslator();

  constructor(
    protected readonly ctx: ContentScriptContext,
    readonly store: Store<OverlayState>,
  ) {}

  start(): void {
    this.ctx.addEventListener(document, 'keydown', (event) => this.onKeyDown(event), { capture: true });

    const unwatchSettings = watchSettings((settings) => this.onSettingsChanged(settings));
    const setSaved = (words: { word: string; lang: string }[]) =>
      this.store.set({ savedKeys: new Set(words.map((w) => vocabKey(w.word, w.lang))) });
    const unwatchVocab = watchVocab(setSaved);
    void getVocab().then(setSaved);
    this.ctx.onInvalidated(() => {
      unwatchSettings();
      unwatchVocab();
    });

    this.store.set({ browserTranslatorMissing: !isBrowserTranslatorSupported() });
    this.onStart();
    this.ctx.requestAnimationFrame(this.tick);
  }

  /** Site-specific setup, run once from `start`. */
  protected abstract onStart(): void;

  /** Runs every frame: finds the video to follow and updates the overlay's layout. */
  protected abstract updateFrame(): HTMLVideoElement | null;

  /** Switches to the track with this `TrackOption.key`. */
  abstract selectTrack(key: string): void;

  /** Link and title saved with a word, pointing at `time` in the video. */
  protected abstract source(time: number): { url: string; title: string };

  /** Loads a subtitle file the viewer picked. Only offered where `canLoadFile` is set. */
  loadFile(_file: File): void {}

  /** Reads a subtitle file the viewer picked. Shows an error and returns null if it has no lines. */
  protected async readSubtitleFile(file: File): Promise<SubtitleTrack | null> {
    let cues: Cue[];
    try {
      cues = parseTextSubtitles(await file.text());
    } catch (error) {
      this.store.set({ status: 'error', error: `Couldn’t read ${file.name}: ${errorMessage(error)}` });
      return null;
    }
    if (cues.length === 0) {
      this.store.set({ status: 'error', error: `No subtitles found in ${file.name}. Glossa reads .srt and .vtt files.` });
      return null;
    }
    const lang =
      languageFromFileName(file.name) ??
      (await detectLanguage(sampleText(cues))) ??
      this.store.get().track?.lang ??
      fallbackLanguage();
    return { lang, label: file.name, cues };
  }

  /** Corrects the current track's language. Only offered where `languageGuessed` is set. */
  setTrackLanguage(_lang: string): void {}

  /** Called after the native language changed; YouTube reloads its translated track. */
  protected onNativeLanguageChanged(): void {
    this.store.set({ lineTranslations: new Map() });
    this.translateAround(this.store.get().displayIndex);
  }

  protected onEnabledChanged(_enabled: boolean): void {}

  private onSettingsChanged(settings: Settings): void {
    const previous = this.store.get().settings;
    this.store.set({ settings });
    if (settings.nativeLanguage !== previous.nativeLanguage) this.onNativeLanguageChanged();
    else if (settings.translator !== previous.translator || JSON.stringify(settings.ai) !== JSON.stringify(previous.ai)) {
      this.store.set({ lineTranslations: new Map() });
      this.ensureLineTranslation(this.store.get().displayIndex);
    }
    if (settings.enabled !== previous.enabled) {
      this.onEnabledChanged(settings.enabled);
      if (!settings.enabled) this.closeCard(false);
    }
  }

  // ----------------------------------------------------------------- tracks

  /** Shows a new track (or none), starting over with its translations. */
  protected setTrack(track: SubtitleTrack | undefined, patch: Partial<OverlayState> = {}): void {
    this.trackGeneration++;
    this.autoPausedIndex = -1;
    this.store.set({
      status: !track ? 'idle' : track.cues.length > 0 ? 'ready' : 'no-subtitles',
      error: undefined,
      track,
      translationTrack: undefined,
      lineTranslations: new Map(),
      displayIndex: -1,
      card: undefined,
      ...patch,
    });
  }

  /**
   * Updates the current track's lines, for players that add them as the video loads. If only new lines
   * were added at the end, everything shown so far stays; otherwise the track starts over.
   */
  protected extendTrack(cues: Cue[]): void {
    const { track } = this.store.get();
    if (!track) return;
    const old = track.cues;
    const appended =
      cues.length >= old.length && old.every((cue, i) => cues[i]!.start === cue.start && cues[i]!.text === cue.text);
    if (appended) this.store.set({ track: { ...track, cues }, status: cues.length > 0 ? 'ready' : 'no-subtitles' });
    else this.setTrack({ ...track, cues }, { translationTrack: this.store.get().translationTrack });
  }

  /** Translates the line on screen and the next one, if needed. */
  protected translateAround(index: number): void {
    this.ensureLineTranslation(index);
    this.ensureLineTranslation(index + 1);
  }

  // --------------------------------------------------------------- playback

  private readonly tick = (): void => {
    const video = this.updateFrame();
    this.video = video;

    const state = this.store.get();
    if (video && state.track && state.active && state.settings.enabled) {
      const cues = state.track.cues;
      const time = video.currentTime;
      const active = findActiveCueIndex(cues, time);

      let display = active;
      if (display === -1 && video.paused) {
        const previous = findCueIndexAtOrBefore(cues, time);
        if (previous !== -1 && time - cues[previous]!.end < LINGER_SECONDS) display = previous;
      }

      const paused = this.autoPausedIndex;
      if (paused !== -1 && (!cues[paused] || time < cues[paused].start - 0.05)) this.autoPausedIndex = -1; // viewer went back
      if (
        state.settings.autoPause &&
        !video.paused &&
        active !== -1 &&
        active !== this.autoPausedIndex &&
        cues[active]!.end - time < AUTO_PAUSE_LEAD
      ) {
        video.pause();
        this.autoPausedIndex = active;
      }

      // The viewer resumed playback (space bar, clicking the video…) while a card was open.
      if (state.card && !video.paused) this.closeCard(false);

      if (display !== state.displayIndex) {
        this.store.set({ displayIndex: display });
        this.translateAround(display);
      }
    }

    this.ctx.requestAnimationFrame(this.tick);
  };

  private seekToCue(index: number): void {
    const cues = this.store.get().track?.cues;
    const video = this.video;
    const cue = cues?.[index];
    if (!cue || !video) return;
    this.closeCard(false);
    this.autoPausedIndex = -1;
    video.currentTime = cue.start + 0.01;
    void video.play();
  }

  previousLine(): void {
    const { track } = this.store.get();
    if (!track || !this.video) return;
    const time = this.video.currentTime;
    const active = findActiveCueIndex(track.cues, time);
    const target = active !== -1 ? active - 1 : findCueIndexAtOrBefore(track.cues, time);
    this.seekToCue(Math.max(target, 0));
  }

  replayLine(): void {
    const { track } = this.store.get();
    if (!track || !this.video) return;
    const time = this.video.currentTime;
    const active = findActiveCueIndex(track.cues, time);
    const target = active !== -1 ? active : findCueIndexAtOrBefore(track.cues, time);
    this.seekToCue(Math.max(target, 0));
  }

  nextLine(): void {
    const { track } = this.store.get();
    if (!track || !this.video) return;
    const target = findCueIndexAtOrBefore(track.cues, this.video.currentTime) + 1;
    if (target < track.cues.length) this.seekToCue(target);
  }

  hoverStart(): void {
    window.clearTimeout(this.hoverEndTimer);
    this.hoverEndTimer = undefined;
    const { settings, card, hovering } = this.store.get();
    if (hovering) return;
    this.store.set({ hovering: true });
    const video = this.video;
    if (settings.pauseOnHover && !card && video && !video.paused) {
      video.pause();
      this.pausedByHover = true;
    }
  }

  hoverEnd(): void {
    window.clearTimeout(this.hoverEndTimer);
    this.hoverEndTimer = this.ctx.setTimeout(() => {
      this.hoverEndTimer = undefined;
      this.store.set({ hovering: false });
      if (this.pausedByHover && !this.store.get().card) void this.video?.play();
      this.pausedByHover = false;
    }, HOVER_GRACE_MS);
  }

  // ----------------------------------------------------------- translations

  /**
   * `extra` carries the line a word is in and the lines around it; AI models and DeepL use them
   * to pick the meaning that fits.
   */
  private translate(text: string, from: string, extra?: Pick<TranslationRequest, 'sentence' | 'context'>): Promise<string> {
    const { settings } = this.store.get();
    const request: TranslationRequest = { text, from, to: settings.nativeLanguage, ...extra };
    // Called synchronously from click handlers so the built-in translator
    // still sees the user gesture it needs to download a language pack.
    if (settings.translator === 'browser') return this.browserTranslator.translate(request);
    return sendMessage('translate', request);
  }

  private setLineTranslation(index: number, value: LineTranslation): void {
    this.store.set((state) => {
      const next = new Map(state.lineTranslations);
      next.set(index, value);
      return { lineTranslations: next };
    });
  }

  /**
   * Whether lines go to the viewer's own translator even when the site has a translated track.
   * YouTube's machine translation is free and instant but often misses the point (Japanese especially),
   * so someone who chose an AI model or DeepL gets that instead, with the track shown while it loads.
   */
  prefersOwnTranslator(): boolean {
    const { translator } = this.store.get().settings;
    return translator === 'ai' || translator === 'deepl';
  }

  /** Translation of a line from the translated track, if there is one. */
  translationFromTrack(index: number): string | undefined {
    const { track, translationTrack } = this.store.get();
    const cue = track?.cues[index];
    if (!cue || !translationTrack) return undefined;
    return findBestOverlap(translationTrack.cues, cue.start, cue.end)?.text;
  }

  private lineTranslationText(index: number): string | undefined {
    const line = this.store.get().lineTranslations.get(index);
    const own = line?.state === 'done' ? line.value : undefined;
    return this.prefersOwnTranslator() ? (own ?? this.translationFromTrack(index)) : (this.translationFromTrack(index) ?? own);
  }

  /** Translates a line ourselves when the translated track doesn't cover it. */
  private ensureLineTranslation(index: number): void {
    const { track, settings, lineTranslations } = this.store.get();
    const cue = track?.cues[index];
    if (!track || !cue || !settings.enabled || settings.translationDisplay === 'hide') return;
    if (baseLanguage(track.lang) === baseLanguage(settings.nativeLanguage)) return;
    if (!this.prefersOwnTranslator() && (this.translationTrackPending || this.translationFromTrack(index))) return;
    if (lineTranslations.has(index)) return;

    if (settings.translator === 'browser') {
      if (!isBrowserTranslatorSupported()) return;
      const generation = this.trackGeneration;
      this.setLineTranslation(index, { state: 'loading' });
      void this.browserTranslator.availability(track.lang, settings.nativeLanguage).then((availability) => {
        if (this.trackGeneration !== generation) return;
        if (availability === 'available') this.translateLine(index, track.lang, cue);
        else if (availability === 'unavailable') {
          this.setLineTranslation(index, {
            state: 'error',
            message: 'The built-in translator doesn’t support this language pair.',
          });
        } else this.setLineTranslation(index, { state: 'needs-click' });
      });
      return;
    }
    this.translateLine(index, track.lang, cue);
  }

  /** For the "translate" button shown when a click is needed or a previous attempt failed. */
  translateLineNow(index: number): void {
    const { track } = this.store.get();
    const cue = track?.cues[index];
    if (track && cue) this.translateLine(index, track.lang, cue);
  }

  private translateLine(index: number, lang: string, cue: Cue): void {
    const generation = this.trackGeneration;
    const cues = this.store.get().track?.cues ?? [];
    this.setLineTranslation(index, { state: 'loading' });
    this.translate(cue.text, lang, { context: subtitleContext(cues, index) }).then(
      (value) => {
        if (this.trackGeneration === generation) this.setLineTranslation(index, { state: 'done', value });
      },
      (error: unknown) => {
        if (this.trackGeneration === generation) {
          this.setLineTranslation(index, { state: 'error', message: errorMessage(error) });
        }
      },
    );
  }

  // ------------------------------------------------------------------ cards

  private pauseForCard(): void {
    if (this.store.get().card) return; // already paused for the open card
    const video = this.video;
    if (video && !video.paused) {
      video.pause();
      this.resumeAfterCard = true;
    } else {
      this.resumeAfterCard = this.pausedByHover;
    }
    this.pausedByHover = false;
  }

  private updateCard(id: number, patch: Partial<CardState>): void {
    const card = this.store.get().card;
    if (card?.id === id) this.store.set({ card: { ...card, ...patch } });
  }

  openWordCard(word: string, cueIndex: number, anchor: CardAnchor): void {
    const { track, settings } = this.store.get();
    const cue = track?.cues[cueIndex];
    if (!track || !cue) return;

    this.pauseForCard();
    const id = ++this.cardSequence;
    const lang = track.lang;
    const needsTranslation = baseLanguage(lang) !== baseLanguage(settings.nativeLanguage);
    this.store.set({
      card: {
        id,
        kind: 'word',
        word,
        cueIndex,
        sentence: cue.text,
        lang,
        anchor,
        translation: needsTranslation ? { state: 'loading' } : { state: 'idle' },
        entries: { state: 'loading' },
        explanation: { state: 'idle' },
      },
    });

    if (needsTranslation) {
      if (settings.translator === 'browser' && !isBrowserTranslatorSupported()) {
        this.updateCard(id, {
          translation: {
            state: 'error',
            message: 'This browser has no built-in translator. Choose another translator in Glossa’s settings.',
          },
        });
      } else {
        this.translate(word, lang, { sentence: cue.text, context: subtitleContext(track.cues, cueIndex) }).then(
          (value) => this.updateCard(id, { translation: { state: 'done', value } }),
          (error: unknown) => this.updateCard(id, { translation: { state: 'error', message: errorMessage(error) } }),
        );
        if (settings.translator === 'browser') {
          void this.browserTranslator.availability(lang, settings.nativeLanguage).then((availability) => {
            const current = this.store.get().card;
            if (current?.id !== id || current.translation.state !== 'loading') return;
            if (availability === 'downloadable' || availability === 'downloading') {
              this.updateCard(id, {
                translation: { state: 'loading', message: 'Downloading the language pack (only needed once)…' },
              });
            }
          });
        }
      }
    }

    sendMessage('lookup', { word, lang }).then(
      (value) => this.updateCard(id, { entries: { state: 'done', value } }),
      (error: unknown) => this.updateCard(id, { entries: { state: 'error', message: errorMessage(error) } }),
    );
  }

  /** Defines the card's word with the AI model, after the dictionary had no entry. */
  lookupWithAi(): void {
    const { card } = this.store.get();
    if (!card) return;
    const id = card.id;
    this.updateCard(id, { aiLookup: true, entries: { state: 'loading' } });
    sendMessage('lookupAi', { word: card.word, lang: card.lang }).then(
      (value) => this.updateCard(id, { entries: { state: 'done', value } }),
      (error: unknown) => this.updateCard(id, { entries: { state: 'error', message: errorMessage(error) } }),
    );
  }

  /** Opens a card explaining the whole line with AI. */
  openLineCard(cueIndex: number, anchor: CardAnchor): void {
    const { track } = this.store.get();
    const cue = track?.cues[cueIndex];
    if (!track || !cue) return;
    this.pauseForCard();
    const id = ++this.cardSequence;
    const translation = this.lineTranslationText(cueIndex);
    this.store.set({
      card: {
        id,
        kind: 'sentence',
        word: '',
        cueIndex,
        sentence: cue.text,
        lang: track.lang,
        anchor,
        translation: translation ? { state: 'done', value: translation } : { state: 'idle' },
        entries: { state: 'idle' },
        explanation: { state: 'idle' },
      },
    });
    this.explainCard();
  }

  explainCard(): void {
    const { card, settings, track } = this.store.get();
    if (!card) return;
    const shared = {
      sentence: card.sentence,
      lang: card.lang,
      explainIn: settings.nativeLanguage,
      context: track ? subtitleContext(track.cues, card.cueIndex) : undefined,
    };
    const request: ExplainRequest =
      card.kind === 'word' ? { kind: 'word', word: card.word, ...shared } : { kind: 'sentence', ...shared };
    const id = card.id;
    this.updateCard(id, { explanation: { state: 'loading' } });
    sendMessage('explain', request).then(
      (value) => this.updateCard(id, { explanation: { state: 'done', value } }),
      (error: unknown) => this.updateCard(id, { explanation: { state: 'error', message: errorMessage(error) } }),
    );
  }

  closeCard(resume = true): void {
    if (!this.store.get().card) return;
    this.store.set({ card: undefined });
    if (resume && this.resumeAfterCard) {
      // Still over the subtitles with pause-on-hover: resume when the mouse leaves instead.
      const { hovering, settings } = this.store.get();
      if (hovering && settings.pauseOnHover) this.pausedByHover = true;
      else void this.video?.play();
    }
    this.resumeAfterCard = false;
  }

  async saveCard(): Promise<void> {
    const { card, track } = this.store.get();
    if (!card || card.kind !== 'word') return;
    const time = track?.cues[card.cueIndex]?.start ?? this.video?.currentTime ?? 0;
    await saveWord({
      word: card.word,
      lang: card.lang,
      translation: card.translation.state === 'done' ? card.translation.value : undefined,
      definition:
        card.entries.state === 'done' ? card.entries.value[0]?.senses[0]?.definition : undefined,
      sentence: card.sentence,
      sentenceTranslation: this.lineTranslationText(card.cueIndex),
      source: { ...this.source(time), time },
    });
  }

  async speak(text: string, lang: string): Promise<void> {
    const id = this.store.get().card?.id;
    if (id === undefined) return;
    this.updateCard(id, { speechError: undefined });
    if (await speakAloud(text, lang)) return;
    this.updateCard(id, {
      speechError: `No on-device ${languageName(lang)} voice is installed. Add one in your system’s speech settings.`,
    });
  }

  // --------------------------------------------------------------- settings

  cycleTranslationDisplay(): void {
    const current = this.store.get().settings.translationDisplay;
    const next = TRANSLATION_DISPLAY_ORDER[(TRANSLATION_DISPLAY_ORDER.indexOf(current) + 1) % 3]!;
    void updateSettings({ translationDisplay: next });
  }

  /** Moves the subtitles while the viewer drags them; `save` stores the position once they let go. */
  moveSubtitles(position: number, save: boolean): void {
    const subtitlePosition = Math.round(Math.min(MAX_SUBTITLE_POSITION, Math.max(0, position)) * 10) / 10;
    this.store.set((state) => ({ settings: { ...state.settings, subtitlePosition } }));
    if (save) void updateSettings({ subtitlePosition });
  }

  toggleAutoPause(): void {
    void updateSettings({ autoPause: !this.store.get().settings.autoPause });
  }

  openSettings(): void {
    void sendMessage('openOptions', null);
  }

  // ------------------------------------------------------------ keyboard

  private onKeyDown(event: KeyboardEvent): void {
    const { settings, track, active, card } = this.store.get();
    if (!settings.enabled || !track || !active) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'a':
        this.previousLine();
        break;
      case 's':
        this.replayLine();
        break;
      case 'd':
        this.nextLine();
        break;
      case 'q':
        this.cycleTranslationDisplay();
        break;
      case 'escape':
        if (!card) return;
        this.closeCard();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
}
