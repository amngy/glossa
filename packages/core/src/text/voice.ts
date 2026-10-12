import { baseLanguage } from './language';

/** The parts of a `SpeechSynthesisVoice` this needs, so it works without browser types. */
export interface VoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

const normalized = (tag: string) => tag.replace('_', '-').toLowerCase();

/**
 * The installed voice that best speaks `lang`: an exact regional match (pt-BR) over any other
 * regional variant, then natural-sounding online voices. Returns undefined when no voice speaks the
 * language, so the caller can say so instead of reading it with an English voice.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | undefined {
  const wanted = normalized(lang);
  const score = (voice: T) =>
    (normalized(voice.lang) === wanted ? 4 : 0) + (/natural|neural|online/i.test(voice.name) ? 2 : 0) + (voice.default ? 1 : 0);
  return voices
    .filter((voice) => baseLanguage(voice.lang) === baseLanguage(lang))
    .sort((a, b) => score(b) - score(a))[0];
}
