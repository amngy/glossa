import { browser, storage, type Browser } from '#imports';
import { baseLanguage } from '@glossa/core';
import { CHROME_SPEECH } from './chrome-speech';
import { sendMessage, type MessageMap } from './messages';
import { installedSpeechPack } from './packs';
import { updateSettings, type Settings } from './settings';
import { startOnTab } from './video-sites';

/** The spoken language last transcribed on each site, by host. Apart from Settings, like the video sites. */
const spokenLanguages = storage.defineItem<Record<string, string>>('local:spokenLanguages', { fallback: {} });

export const TAB_CAPTURE = { permissions: ['tabCapture'] as Browser.runtime.ManifestPermission[] };

export function isYouTube(url: string | undefined): boolean {
  try {
    return !!url && /(^|\.)youtube\.com$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function host(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

/** The language to listen for on this page: the one last used on its site, else the last one used anywhere. */
export async function spokenLanguageFor(url: string | undefined, settings: Settings): Promise<string> {
  return (
    (await spokenLanguages.getValue())[host(url)] ||
    settings.spokenLanguage ||
    (baseLanguage(settings.nativeLanguage) === 'ja' ? 'en' : 'ja')
  );
}

export async function rememberSpokenLanguage(url: string | undefined, language: string): Promise<void> {
  const site = host(url);
  if (site) await spokenLanguages.setValue({ ...(await spokenLanguages.getValue()), [site]: language });
}

/** Look-ahead reads the audio YouTube's player has buffered, so it needs no tab capture. */
export function usesLookAhead(tab: Browser.tabs.Tab, settings: Settings): boolean {
  return settings.lookAhead && isYouTube(tab.url);
}

/**
 * Starts transcribing a tab, starting Glossa's overlay there first if needed. Only right after the viewer
 * clicked Glossa's button or pressed its shortcut: tab capture needs that. Tab capture's permission must
 * already be granted unless look-ahead is used. The background worker passes its own `asrStart`, since it
 * can't message itself.
 */
export async function startTranscribing(
  tab: Browser.tabs.Tab,
  settings: Settings,
  language: string,
  asrStart: (request: MessageMap['asrStart']['request']) => Promise<unknown> = (request) => sendMessage('asrStart', request),
): Promise<void> {
  const tabId = tab.id!;
  const pack = (await installedSpeechPack())?.id;
  void rememberSpokenLanguage(tab.url, language);
  if (language !== settings.spokenLanguage) void updateSettings({ spokenLanguage: language });
  if (usesLookAhead(tab, settings) && (pack || settings.companion)) {
    await asrStart({ tabId, language, pack: pack ?? '' });
    return;
  }
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
  // Other sites need Glossa's overlay started first; YouTube's is always there.
  if (!isYouTube(tab.url)) await startOnTab(tabId);
  await asrStart({ tabId, streamId, language, pack: (settings.chromeSpeech ? CHROME_SPEECH : pack) ?? '' });
}
