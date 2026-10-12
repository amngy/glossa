export interface SavedWord {
  id: string;
  word: string;
  /** Language of the word (BCP 47). */
  lang: string;
  translation?: string;
  definition?: string;
  /** The subtitle line the word was saved from. */
  sentence: string;
  sentenceTranslation?: string;
  source?: {
    url: string;
    title?: string;
    /** Playback position in seconds. */
    time?: number;
  };
  createdAt: number;
}

function csvField(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(words: readonly SavedWord[]): string {
  const header = [
    'word', 'language', 'translation', 'definition', 'sentence', 'sentence_translation',
    'source_url', 'source_title', 'time_seconds', 'saved_at',
  ];
  const rows = words.map((w) =>
    [
      w.word, w.lang, w.translation, w.definition, w.sentence, w.sentenceTranslation,
      w.source?.url, w.source?.title,
      w.source?.time === undefined ? undefined : Math.round(w.source.time),
      new Date(w.createdAt).toISOString(),
    ]
      .map(csvField)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Anki fields can't contain raw tabs or newlines in a TSV import. */
function ankiField(html: string): string {
  return html.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
}

/**
 * Tab-separated file for Anki's File → Import. The header lines tell Anki the
 * separator, that fields contain HTML, and which column holds tags.
 */
export function toAnkiTsv(words: readonly SavedWord[]): string {
  const lines = ['#separator:tab', '#html:true', '#columns:Front\tBack\tTags', '#tags column:3'];
  for (const w of words) {
    const sentence = escapeHtml(w.sentence).replace(
      new RegExp(escapeRegExp(escapeHtml(w.word)), 'iu'),
      (match) => `<b>${match}</b>`,
    );
    const front = `${escapeHtml(w.word)}<br><br><i>${sentence}</i>`;
    const back = [
      w.translation && `<b>${escapeHtml(w.translation)}</b>`,
      w.definition && escapeHtml(w.definition),
      w.sentenceTranslation && `<i>${escapeHtml(w.sentenceTranslation)}</i>`,
    ]
      .filter(Boolean)
      .join('<br><br>');
    const tags = `glossa glossa::${w.lang.replace(/\s+/g, '_')}`;
    lines.push([front, back, tags].map(ankiField).join('\t'));
  }
  return lines.join('\n') + '\n';
}
