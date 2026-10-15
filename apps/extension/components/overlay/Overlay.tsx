import { baseLanguage, rubyIn, tokenize, type Cue, type RubySpan } from '@glossa/core';
import type { RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { languageOptions } from '@/lib/languages';
import { MAX_SUBTITLE_POSITION } from '@/lib/settings';
import { useStore, type Store } from '@/lib/store';
import { vocabKey } from '@/lib/vocab-store';
import { LIVE_INDEX, PREVIOUS_LINE_SECONDS, TRANSCRIPT_KEY, type SubtitleController } from './controller';
import { FileIcon, MoveIcon, NextIcon, PauseLineIcon, PreviousIcon, ReplayIcon, SettingsIcon, SparkleIcon, TranslateIcon } from './icons';
import type { CardAnchor, OverlayState } from './state';
import { WordCard } from './WordCard';

/** Keeps keyboard focus on the player so YouTube's shortcuts keep working after a click. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

const TRANSLATION_LABELS = { show: 'Translation: shown', blur: 'Translation: blurred until hover', hide: 'Translation: hidden' };

/** Lets the viewer drag the subtitles up or down, for example off subtitles burned into the video. */
function startMove(event: PointerEvent, controller: SubtitleController, rootRef: RefObject<HTMLDivElement>, maxRaise: number) {
  if (event.button !== 0 || !rootRef.current) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  const height = rootRef.current.getBoundingClientRect().height || 1;
  const startY = event.clientY;
  const startPosition = Math.min(maxRaise, controller.store.get().settings.subtitlePosition);
  const positionAt = (y: number) => Math.min(maxRaise, startPosition + ((startY - y) / height) * 100);
  handle.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => controller.moveSubtitles(positionAt(e.clientY), false);
  const end = (e: PointerEvent) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    controller.moveSubtitles(positionAt(e.clientY), true);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function useAnchor(subsRef: RefObject<HTMLDivElement>, rootRef: RefObject<HTMLDivElement>) {
  return (element: Element): CardAnchor => {
    const box = subsRef.current!.getBoundingClientRect();
    const root = rootRef.current!.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const margin = 8;
    return {
      x: target.left - box.left + target.width / 2,
      top: target.top - box.top,
      bottom: target.bottom - box.top,
      boxHeight: box.height,
      minX: root.left - box.left + margin,
      maxX: root.right - box.left - margin,
      spaceAbove: target.top - root.top,
      spaceBelow: root.bottom - target.bottom,
    };
  };
}

function Line({
  cue,
  index,
  state,
  controller,
  anchorFor,
  settledLength = Infinity,
}: {
  cue: Cue;
  index: number;
  state: OverlayState;
  controller: SubtitleController;
  anchorFor: (element: Element) => CardAnchor;
  /** Words starting at or after this many characters are provisional: grey and not clickable. */
  settledLength?: number;
}) {
  const lang = state.track!.lang;
  const tokens = useMemo(() => tokenize(cue.text, lang), [cue.text, lang]);
  const wantReadings = state.settings.showReadings && ['ja', 'zh'].includes(baseLanguage(lang)) && settledLength === Infinity;
  const [spans, setSpans] = useState<RubySpan[]>([]);
  useEffect(() => {
    let current = true;
    setSpans([]);
    if (wantReadings) void controller.readingSpans(cue.text, lang).then((found) => current && setSpans(found));
    return () => {
      current = false;
    };
  }, [cue.text, wantReadings]);
  let offset = 0;
  const selected = state.card?.kind === 'word' && state.card.cueIndex === index ? state.card.word : null;

  return (
    <div class="glossa-line" lang={lang}>
      {tokens.map((token, i) => {
        const start = offset;
        offset += token.text.length;
        if (!token.isWord) {
          const parts = token.text.split('\n');
          return parts.map((part, j) => [j > 0 && <br key={`${i}-${j}-br`} />, part]);
        }
        if (start >= settledLength) return <span key={i} class="glossa-word-provisional">{token.text}</span>;
        const classes = ['glossa-word'];
        const key = vocabKey(token.text, lang);
        if (!state.knownKeys.has(key)) {
          if (state.savedKeys.has(key)) classes.push('glossa-word-saved');
          else if (state.settings.markNewWords) classes.push('glossa-word-new');
        }
        if (token.text === selected) classes.push('glossa-word-selected');
        return (
          <span
            key={i}
            class={classes.join(' ')}
            onMouseDown={keepFocus}
            onClick={(event) => controller.openWordCard(token.text, index, anchorFor(event.currentTarget))}
          >
            {rubyIn(cue.text, spans, start, offset).map((part, j) =>
              part.ruby ? (
                <ruby key={j}>
                  {part.text}
                  <rt>{part.ruby}</rt>
                </ruby>
              ) : (
                part.text
              ),
            )}
          </span>
        );
      })}
    </div>
  );
}

function Translation({ index, state, controller }: { index: number; state: OverlayState; controller: SubtitleController }) {
  const { settings, track } = state;
  if (!track || settings.translationDisplay === 'hide') return null;
  if (baseLanguage(track.lang) === baseLanguage(settings.nativeLanguage)) return null;

  const fromTrack = controller.translationFromTrack(index);
  const own = state.lineTranslations.get(index);
  // The site's translation fills in while the viewer's own translator is still working (or failed).
  const line =
    fromTrack && (!controller.prefersOwnTranslator() || own?.state !== 'done')
      ? ({ state: 'done', value: fromTrack } as const)
      : own;
  const blurred = settings.translationDisplay === 'blur' ? ' glossa-blurred' : '';

  switch (line?.state) {
    case 'done':
      return <div class={`glossa-translation${blurred}`}>{line.value}</div>;
    case 'loading':
      return line.draft ? (
        <div class={`glossa-translation${blurred}`}>{line.draft}</div>
      ) : (
        <div class="glossa-translation glossa-muted">…</div>
      );
    case 'needs-click':
      return (
        <button class="glossa-translation glossa-translation-action" onMouseDown={keepFocus} onClick={() => controller.translateLineNow(index)}>
          Show translation (the first time downloads a language pack)
        </button>
      );
    case 'error':
      return (
        <button
          class="glossa-translation glossa-translation-action"
          title={line.message}
          onMouseDown={keepFocus}
          onClick={() => controller.translateLineNow(index)}
        >
          Translation failed: retry
        </button>
      );
    default:
      return null;
  }
}

function Toolbar({
  state,
  controller,
  onExplainLine,
  rootRef,
  maxRaise,
}: {
  state: OverlayState;
  controller: SubtitleController;
  onExplainLine: ((element: Element) => void) | null;
  rootRef: RefObject<HTMLDivElement>;
  maxRaise: number;
}) {
  const { settings, tracks, status, track } = state;
  const fileInput = useRef<HTMLInputElement>(null);
  const statusText =
    state.notice ??
    (status === 'loading'
      ? 'Loading subtitles…'
      : status === 'no-subtitles'
        ? state.canLoadFile
          ? 'No subtitles found. Load a subtitle file:'
          : 'No subtitles for this video'
        : status === 'error'
          ? state.error
          : null);

  return (
    <div class="glossa-toolbar" role="toolbar" aria-label="Glossa">
      <span
        class="glossa-brand glossa-handle"
        title="Drag to move the subtitles up or down. Double-click to put them back."
        onPointerDown={(event) => startMove(event, controller, rootRef, maxRaise)}
        onDblClick={() => controller.moveSubtitles(0, true)}
      >
        <MoveIcon />
        Glossa
      </span>
      {statusText && <span class="glossa-status">{statusText}</span>}
      {state.track && (
        <>
          <button class="glossa-tool" title="Previous line (A)" aria-label="Previous line" onMouseDown={keepFocus} onClick={() => controller.previousLine()}>
            <PreviousIcon />
          </button>
          <button class="glossa-tool" title="Replay line (S)" aria-label="Replay line" onMouseDown={keepFocus} onClick={() => controller.replayLine()}>
            <ReplayIcon />
          </button>
          <button class="glossa-tool" title="Next line (D)" aria-label="Next line" onMouseDown={keepFocus} onClick={() => controller.nextLine()}>
            <NextIcon />
          </button>
          <span class="glossa-divider" />
          <button
            class={`glossa-tool${settings.translationDisplay !== 'show' ? ' glossa-tool-dim' : ''}`}
            title={`${TRANSLATION_LABELS[settings.translationDisplay]} (Q to change)`}
            aria-label={TRANSLATION_LABELS[settings.translationDisplay]}
            onMouseDown={keepFocus}
            onClick={() => controller.cycleTranslationDisplay()}
          >
            <TranslateIcon />
            <span class="glossa-tool-label">{settings.translationDisplay}</span>
          </button>
          <button
            class={`glossa-tool${settings.autoPause ? ' glossa-tool-on' : ''}`}
            title={settings.autoPause ? 'Auto-pause after each line: on' : 'Auto-pause after each line: off'}
            aria-label="Auto-pause after each line"
            aria-pressed={settings.autoPause}
            onMouseDown={keepFocus}
            onClick={() => controller.toggleAutoPause()}
          >
            <PauseLineIcon />
          </button>
          {onExplainLine && (
            <button
              class="glossa-tool"
              title="Explain this line with AI"
              aria-label="Explain this line with AI"
              onMouseDown={keepFocus}
              onClick={(event) => onExplainLine(event.currentTarget)}
            >
              <SparkleIcon />
            </button>
          )}
        </>
      )}
      {tracks.length > 1 && (
        <select
          class="glossa-select"
          title="Subtitle track"
          aria-label="Subtitle track"
          value={state.trackKey ?? ''}
          onChange={(event) => controller.selectTrack(event.currentTarget.value)}
        >
          {!state.trackKey && <option value="">Choose subtitles…</option>}
          {tracks.map((option) => (
            <option key={option.key} value={option.key}>
              {option.name}
            </option>
          ))}
        </select>
      )}
      {track && state.languageGuessed && (
        <select
          class="glossa-select"
          title="Language of these subtitles"
          aria-label="Language of these subtitles"
          value={track.lang}
          onChange={(event) => controller.setTrackLanguage(event.currentTarget.value)}
        >
          {languageOptions(track.lang).map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {state.canLoadFile && (
        <>
          <button
            class="glossa-tool"
            title="Load a subtitle file (.srt or .vtt)"
            aria-label="Load a subtitle file"
            onMouseDown={keepFocus}
            onClick={() => fileInput.current?.click()}
          >
            <FileIcon />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".srt,.vtt,.ass,.ssa,text/vtt"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) controller.loadFile(file);
            }}
          />
        </>
      )}
      <button class="glossa-tool" title="Glossa settings" aria-label="Glossa settings" onMouseDown={keepFocus} onClick={() => controller.openSettings()}>
        <SettingsIcon />
      </button>
    </div>
  );
}

export function Overlay({ store, controller }: { store: Store<OverlayState>; controller: SubtitleController }) {
  const state = useStore(store);
  const rootRef = useRef<HTMLDivElement>(null);
  const subsRef = useRef<HTMLDivElement>(null);
  const anchorFor = useAnchor(subsRef, rootRef);

  const { settings, track, displayIndex } = state;
  const visible = settings.enabled && state.active && !state.adShowing;

  // The subtitles' own height, so they can't be raised past the top of the player.
  const [subsHeight, setSubsHeight] = useState(0);
  useEffect(() => {
    const subs = subsRef.current;
    if (!subs) return;
    const observer = new ResizeObserver(() => setSubsHeight(subs.offsetHeight));
    observer.observe(subs);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) return null;

  const live = state.live;
  const cue = live ? live.cue : track && displayIndex >= 0 ? track.cues[displayIndex] : undefined;
  const cueIndex = live ? LIVE_INDEX : displayIndex;
  // Transcribed speech keeps two rows (the line before above the current one), so lines don't jump.
  const before = track?.cues[displayIndex - 1];
  const previousIndex = live
    ? live.previousIndex
    : state.trackKey === TRANSCRIPT_KEY && cue && before && cue.start - before.end < PREVIOUS_LINE_SECONDS
      ? displayIndex - 1
      : undefined;
  const previous = previousIndex !== undefined ? track?.cues[previousIndex] : undefined;
  const fontSize = Math.round(Math.min(44, Math.max(15, state.playerHeight * 0.042 * settings.fontScale)));
  const canExplain = settings.ai.provider !== 'none' && cue !== undefined;
  const baseline = state.controlsHeight > 0 ? state.controlsHeight : state.playerHeight * 0.035;
  const roomAbove = ((state.playerHeight - subsHeight - baseline) / state.playerHeight) * 100;
  const maxRaise = Math.max(0, Math.min(MAX_SUBTITLE_POSITION, roomAbove));
  const raise = Math.min(maxRaise, Math.max(0, settings.subtitlePosition));
  const box = state.box;
  const placement = box
    ? { inset: 'auto', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
    : {};

  return (
    <div ref={rootRef} class="glossa-root" style={{ '--glossa-font-size': `${fontSize}px`, ...placement }}>
      <div
        ref={subsRef}
        class={`glossa-subs${state.hovering || state.controlsVisible ? ' glossa-show-toolbar' : ''}${state.card ? ' glossa-has-card' : ''}`}
        style={{ bottom: `calc(${state.controlsHeight > 0 ? `${state.controlsHeight}px` : '3.5%'} + ${raise}%)` }}
        onMouseEnter={() => controller.hoverStart()}
        onMouseLeave={() => controller.hoverEnd()}
      >
        <Toolbar
          state={state}
          controller={controller}
          onExplainLine={canExplain && !live ? (element) => controller.openLineCard(displayIndex, anchorFor(element)) : null}
          rootRef={rootRef}
          maxRaise={maxRaise}
        />
        {previous && previousIndex !== undefined && (
          <div class="glossa-previous">
            <Line cue={previous} index={previousIndex} state={state} controller={controller} anchorFor={anchorFor} />
            <Translation index={previousIndex} state={state} controller={controller} />
          </div>
        )}
        {cue && (
          <Line cue={cue} index={cueIndex} state={state} controller={controller} anchorFor={anchorFor} settledLength={live?.settledLength} />
        )}
        {cue && <Translation index={cueIndex} state={state} controller={controller} />}
        {state.card && <WordCard card={state.card} state={state} controller={controller} />}
      </div>
    </div>
  );
}
