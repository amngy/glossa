import { COMMON_LANGUAGES, languageName } from '@glossa/core';

export interface LanguageOption {
  code: string;
  label: string;
}

/** Picker options like "German — Deutsch", sorted by English name. Includes `current` if it isn't a common language. */
export function languageOptions(current?: string): LanguageOption[] {
  const codes = new Set<string>(COMMON_LANGUAGES);
  if (current) codes.add(current);
  return [...codes]
    .map((code) => {
      const english = languageName(code, 'en');
      const native = languageName(code, code);
      return { code, label: native && native.toLowerCase() !== english.toLowerCase() ? `${english} — ${native}` : english };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
