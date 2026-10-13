/**
 * Chrome's on-device speech recognition (`SpeechRecognition` with `processLocally`). Its default sends
 * the audio to Google, so everything that starts it goes through `startLocalOnly`: no cloud fallback.
 */

/** The recognizer languages Chrome's on-device engine offers for Glossa's targets (no Arabic). */
const LOCAL_TAGS: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ru: 'ru-RU',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  hi: 'hi-IN',
};

/** The language tag for a base language such as "ja", or undefined if Chrome has no on-device pack for it. */
export function localSpeechTag(language: string): string | undefined {
  return LOCAL_TAGS[language.split('-')[0]?.toLowerCase() ?? ''];
}

export interface LocalRecognizer {
  processLocally?: boolean;
  start(track: MediaStreamTrack): void;
}

/**
 * Starts `recognizer` on `track` only if it is on-device. A Chrome without `processLocally` ignores the
 * property and would use the cloud, so the recognizer must have it and keep it set.
 */
export function startLocalOnly(recognizer: LocalRecognizer, track: MediaStreamTrack): void {
  if (!('processLocally' in recognizer)) throw new Error('This browser can’t recognise speech on this device, and Glossa never uses the cloud.');
  recognizer.processLocally = true;
  if (recognizer.processLocally !== true) throw new Error('Speech recognition could not be kept on this device.');
  recognizer.start(track);
}
