import { baseLanguage, languageName, type DictionaryEntry } from '@glossa/core';
import { vocabKey } from '@/lib/vocab-store';
import type { SubtitleController } from './controller';
import { CloseIcon, SpeakIcon, StarIcon } from './icons';
import type { Async, CardState, OverlayState } from './state';

const CARD_WIDTH = 340;
/** The card opens above the subtitles unless they were moved up so far that it fits better below. */
const MIN_SPACE_ABOVE = 260;
const keepFocus = (event: MouseEvent) => event.preventDefault();

function Definitions({ entries, word }: { entries: Async<DictionaryEntry[]>; word: string }) {
  switch (entries.state) {
    case 'loading':
      return <p class="glossa-muted">Looking up…</p>;
    case 'error':
      return <p class="glossa-muted">Dictionary unavailable: {entries.message}</p>;
    case 'done':
      if (entries.value.length === 0) return <p class="glossa-muted">No dictionary entry for “{word}”.</p>;
      return (
        <div class="glossa-definitions">
          {entries.value.slice(0, 2).map((entry, i) => (
            <div key={i}>
              {entry.partOfSpeech && <div class="glossa-pos">{entry.partOfSpeech}</div>}
              <ol>
                {entry.senses.slice(0, 3).map((sense, j) => (
                  <li key={j}>
                    {sense.definition}
                    {sense.examples[0] && <div class="glossa-example">{sense.examples[0]}</div>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <a
            class="glossa-source"
            href={`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Wiktionary · CC BY-SA
          </a>
        </div>
      );
    default:
      return null;
  }
}

function Explanation({ card, controller, aiEnabled }: { card: CardState; controller: SubtitleController; aiEnabled: boolean }) {
  if (!aiEnabled) {
    return (
      <p class="glossa-muted">
        Want grammar explanations?{' '}
        <button class="glossa-link" onMouseDown={keepFocus} onClick={() => controller.openSettings()}>
          Connect an AI model
        </button>
      </p>
    );
  }
  const { explanation } = card;
  switch (explanation.state) {
    case 'idle':
      return (
        <button class="glossa-button" onMouseDown={keepFocus} onClick={() => controller.explainCard()}>
          Explain with AI
        </button>
      );
    case 'loading':
      return <p class="glossa-muted">Thinking…</p>;
    case 'done':
      return <p class="glossa-explanation">{explanation.value}</p>;
    case 'error':
      return (
        <p class="glossa-error">
          {explanation.message}{' '}
          <button class="glossa-link" onMouseDown={keepFocus} onClick={() => controller.explainCard()}>
            Retry
          </button>
        </p>
      );
  }
}

export function WordCard({ card, state, controller }: { card: CardState; state: OverlayState; controller: SubtitleController }) {
  const { anchor } = card;
  const width = Math.min(CARD_WIDTH, anchor.maxX - anchor.minX);
  const left = Math.min(Math.max(anchor.x - width / 2, anchor.minX), anchor.maxX - width);
  const below = anchor.spaceAbove < MIN_SPACE_ABOVE && anchor.spaceBelow > anchor.spaceAbove;
  const style = {
    left: `${left}px`,
    width: `${width}px`,
    ...(below
      ? { top: `${anchor.bottom + 10}px`, maxHeight: `${Math.max(anchor.spaceBelow - 20, 120)}px` }
      : { bottom: `${anchor.boxHeight - anchor.top + 10}px`, maxHeight: `${Math.max(anchor.spaceAbove - 20, 120)}px` }),
  };

  const isWord = card.kind === 'word';
  const saved = isWord && state.savedKeys.has(vocabKey(card.word, card.lang));
  const sameLanguage = baseLanguage(card.lang) === baseLanguage(state.settings.nativeLanguage);
  const aiEnabled = state.settings.ai.provider !== 'none';
  const { translation } = card;

  return (
    <div class="glossa-card" style={style} role="dialog" aria-label={isWord ? `Word: ${card.word}` : 'Line explanation'}>
      <header class="glossa-card-header">
        {isWord ? (
          <span class="glossa-card-word" lang={card.lang}>
            {card.word}
          </span>
        ) : (
          <span class="glossa-card-title">Explain this line</span>
        )}
        <span class="glossa-card-lang">{languageName(card.lang)}</span>
        <span class="glossa-spacer" />
        <button
          class="glossa-icon-button"
          title="Listen"
          aria-label="Listen"
          onMouseDown={keepFocus}
          onClick={() => controller.speak(isWord ? card.word : card.sentence, card.lang)}
        >
          <SpeakIcon />
        </button>
        {isWord && (
          <button
            class={`glossa-icon-button${saved ? ' glossa-saved' : ''}`}
            title={saved ? 'Saved — click to update' : 'Save word'}
            aria-label={saved ? 'Saved' : 'Save word'}
            aria-pressed={saved}
            onMouseDown={keepFocus}
            onClick={() => void controller.saveCard()}
          >
            <StarIcon filled={saved} />
          </button>
        )}
        <button
          class="glossa-icon-button"
          title="Close (Esc)"
          aria-label="Close"
          onMouseDown={keepFocus}
          onClick={() => controller.closeCard()}
        >
          <CloseIcon />
        </button>
      </header>

      {!isWord && (
        <p class="glossa-card-sentence" lang={card.lang}>
          {card.sentence}
        </p>
      )}

      {!sameLanguage && translation.state !== 'idle' && (
        <div class="glossa-card-translation">
          {translation.state === 'loading' && <span class="glossa-muted">{translation.message ?? 'Translating…'}</span>}
          {translation.state === 'done' && translation.value}
          {translation.state === 'error' && <span class="glossa-error">{translation.message}</span>}
        </div>
      )}

      {isWord && <Definitions entries={card.entries} word={card.word} />}

      <div class="glossa-card-ai">
        <Explanation card={card} controller={controller} aiEnabled={aiEnabled} />
      </div>
    </div>
  );
}
