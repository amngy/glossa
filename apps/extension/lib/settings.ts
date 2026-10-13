import { storage } from '#imports';
import { baseLanguage } from '@glossa/core';
import { DEFAULT_ON_DEVICE_MODEL } from './on-device-models';

/** Where translations of words and lines come from. */
export type TranslatorChoice = 'browser' | 'ai' | 'libretranslate' | 'deepl';
/**
 * - `built-in`: the browser's own model (Gemini Nano in Chrome)
 * - `on-device`: Glossa's downloadable model, run on the GPU (see on-device-models.ts)
 * - `openai-compatible`: Ollama, LM Studio or any server with an OpenAI-style API
 */
export type AiProvider = 'none' | 'built-in' | 'on-device' | 'anthropic' | 'openai-compatible';
export type TranslationDisplay = 'show' | 'blur' | 'hide';

/** Highest the subtitles can be moved, in percent of the video's height, so they stay on screen. */
export const MAX_SUBTITLE_POSITION = 80;

export interface Settings {
  enabled: boolean;
  /** Language that translations and explanations are written in. */
  nativeLanguage: string;
  /** The language spoken in videos Glossa transcribes; empty until the viewer picks one. */
  spokenLanguage: string;
  /** Recognise speech with Chrome's on-device engine instead of a Whisper pack. Off until the viewer opts in. */
  chromeSpeech: boolean;
  translator: TranslatorChoice;
  libreTranslateUrl: string;
  ai: {
    provider: AiProvider;
    /** Empty means the provider's default. */
    model: string;
    /** For OpenAI-compatible servers, e.g. Ollama at http://localhost:11434/v1. */
    baseUrl: string;
    /** Size of the on-device model, an id from ON_DEVICE_MODELS. */
    onDeviceModel: string;
  };
  translationDisplay: TranslationDisplay;
  pauseOnHover: boolean;
  autoPause: boolean;
  /** Underline words that are neither saved nor marked as known, so new ones stand out. */
  markNewWords: boolean;
  /** Furigana over kanji, from the Japanese readings pack. */
  showReadings: boolean;
  fontScale: number;
  /** How far the subtitles are raised from their usual spot at the bottom, in percent of the video's height. */
  subtitlePosition: number;
}

/**
 * API keys are stored apart from preferences so code that only needs
 * preferences (like the in-page overlay) never loads them. Only the
 * background worker reads this.
 */
export interface Secrets {
  anthropicApiKey: string;
  openaiCompatibleApiKey: string;
  deeplApiKey: string;
  libreTranslateApiKey: string;
}

function defaultNativeLanguage(): string {
  return baseLanguage(globalThis.navigator?.language || 'en');
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  nativeLanguage: defaultNativeLanguage(),
  spokenLanguage: '',
  chromeSpeech: false,
  translator: 'browser',
  libreTranslateUrl: 'http://localhost:5000',
  ai: { provider: 'none', model: '', baseUrl: 'http://localhost:11434/v1', onDeviceModel: DEFAULT_ON_DEVICE_MODEL },
  translationDisplay: 'show',
  pauseOnHover: true,
  autoPause: false,
  markNewWords: false,
  showReadings: false,
  fontScale: 1,
  subtitlePosition: 0,
};

const EMPTY_SECRETS: Secrets = {
  anthropicApiKey: '',
  openaiCompatibleApiKey: '',
  deeplApiKey: '',
  libreTranslateApiKey: '',
};

const settingsItem = storage.defineItem<Partial<Settings>>('local:settings', { fallback: {} });
const secretsItem = storage.defineItem<Partial<Secrets>>('local:secrets', { fallback: {} });

/** Fills in fields added in newer versions so stored settings never miss a key. */
function withDefaults(stored: Partial<Settings> | null): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    ai: { ...DEFAULT_SETTINGS.ai, ...stored?.ai },
  };
}

export async function getSettings(): Promise<Settings> {
  return withDefaults(await settingsItem.getValue());
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => callback(withDefaults(value)));
}

export async function getSecrets(): Promise<Secrets> {
  return { ...EMPTY_SECRETS, ...(await secretsItem.getValue()) };
}

export async function updateSecrets(patch: Partial<Secrets>): Promise<void> {
  await secretsItem.setValue({ ...(await getSecrets()), ...patch });
}
