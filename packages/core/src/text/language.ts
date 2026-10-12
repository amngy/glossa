/** "pt-BR" → "pt", "zh_Hant" → "zh". */
export function baseLanguage(tag: string): string {
  return (tag.split(/[-_]/)[0] ?? tag).toLowerCase();
}

/** Human-readable language name, e.g. languageName("es", "en") → "Spanish". */
export function languageName(tag: string, displayLocale = 'en'): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Languages offered in settings pickers. Any BCP 47 tag still works where a provider supports it. */
export const COMMON_LANGUAGES = [
  'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl',
  'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'zh',
] as const;

const COMMON_LANGUAGE_SET: ReadonlySet<string> = new Set(COMMON_LANGUAGES);

/**
 * Guesses a subtitle file's language from its name, the way media players
 * name them: "Movie.2020.es.srt", "show_S01E01.pt-BR.vtt", "Film [German].srt".
 * Only the last few name parts are checked, so a title word isn't mistaken
 * for a language. Returns null when there's no clear hint.
 */
export function languageFromFileName(fileName: string): string | null {
  const stem = fileName.replace(/^.*[\/]/, '').replace(/\.[^.]*$/, '');
  const parts = stem.split(/[\s._()[\]]+/).filter(Boolean).slice(-4).reverse();
  const names = new Map(COMMON_LANGUAGES.map((code) => [languageName(code, 'en').toLowerCase(), code]));
  for (const part of parts) {
    const tag = /^([a-z]{2})(?:-([a-z]{2}|[a-z]{4}))?$/i.exec(part);
    if (tag && COMMON_LANGUAGE_SET.has(tag[1]!.toLowerCase())) {
      const base = tag[1]!.toLowerCase();
      return tag[2] ? `${base}-${tag[2].length === 2 ? tag[2].toUpperCase() : tag[2]}` : base;
    }
    const named = names.get(part.toLowerCase());
    if (named) return named;
  }
  return null;
}
