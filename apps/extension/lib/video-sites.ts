import { browser, storage } from '#imports';
import { originPattern, requiredOrigins } from './permissions';
import { getSettings } from './settings';

/**
 * Sites where Glossa's subtitles for any HTML5 video start on their own, as match patterns
 * ("https://example.com/*"). Elsewhere they start only when the viewer asks from the toolbar popup.
 * Stored apart from Settings so the settings page, which saves its whole draft, can't overwrite them.
 */
const videoSitesItem = storage.defineItem<string[]>('local:videoSites', { fallback: [] });

/** The content script for any page's videos (entrypoints/video.content). */
export const VIDEO_SCRIPT = '/content-scripts/video.js';
const SCRIPT_ID = 'glossa-video';
/** Copies the subtitle files Stremio Web downloads (entrypoints/stremio-hook.content.ts). It must run before the page's own scripts. */
const STREMIO_HOOK = '/content-scripts/stremio-hook.js';
const STREMIO_HOOK_ID = 'glossa-stremio-hook';
const STREMIO = 'https://web.stremio.com/*';

export function getVideoSites(): Promise<string[]> {
  return videoSitesItem.getValue();
}

export function watchVideoSites(callback: (sites: string[]) => void): () => void {
  return videoSitesItem.watch((sites) => callback(sites ?? []));
}

/** The pattern Glossa uses for the page at `url`, or null when it can't run there. */
export function videoSitePattern(url: string | undefined): string | null {
  return url ? originPattern(url) : null;
}

/**
 * Adds a site. Must be called directly from a click handler, before any `await`,
 * because browsers only ask for permissions during a user gesture.
 */
export function addVideoSite(pattern: string): Promise<boolean> {
  return browser.permissions.request({ origins: [pattern] }).then(async (granted) => {
    if (granted) {
      const sites = await getVideoSites();
      if (!sites.includes(pattern)) await videoSitesItem.setValue([...sites, pattern]);
    }
    return granted;
  });
}

/** Removes a site, and Glossa's access to it unless a translation or AI server there still needs it. */
export async function removeVideoSite(pattern: string): Promise<void> {
  await videoSitesItem.setValue((await getVideoSites()).filter((site) => site !== pattern));
  if (!requiredOrigins(await getSettings()).includes(pattern)) {
    await browser.permissions.remove({ origins: [pattern] }).catch(() => false);
  }
}

/** Sites from the list that Glossa still has permission for (the viewer can revoke it in the browser). */
export async function grantedVideoSites(): Promise<string[]> {
  const sites = await getVideoSites();
  const granted = await Promise.all(sites.map((site) => browser.permissions.contains({ origins: [site] })));
  return sites.filter((_, i) => granted[i]);
}

let syncing = Promise.resolve();

/** Registers the video content script for the saved sites. Background only. */
export function syncVideoSites(): Promise<void> {
  syncing = syncing.then(async () => {
    const matches = await grantedVideoSites();
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, STREMIO_HOOK_ID] });
    if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
    if (matches.length === 0) return;
    await browser.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches, js: [VIDEO_SCRIPT.slice(1)], runAt: 'document_idle', allFrames: true },
      ...(matches.includes(STREMIO)
        ? [{ id: STREMIO_HOOK_ID, matches: [STREMIO], js: [STREMIO_HOOK.slice(1)], runAt: 'document_start' as const, world: 'MAIN' as const }]
        : []),
    ]);
  }).catch((error: unknown) => console.warn('Glossa: couldn’t register the video script', error));
  return syncing;
}

/**
 * Starts Glossa on the video(s) in a tab, in every frame it can reach, and returns how many
 * videos it found. Needs the activeTab grant that opening the popup gives.
 */
export async function startOnTab(tabId: number): Promise<number> {
  // Sees only the subtitles Stremio downloads from now on, unless the site is "Always on".
  if (videoSitePattern((await browser.tabs.get(tabId)).url) === STREMIO) {
    await browser.scripting.executeScript({ target: { tabId }, files: [STREMIO_HOOK], world: 'MAIN' });
  }
  let results;
  try {
    results = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: [VIDEO_SCRIPT] });
  } catch {
    // Some frames are off-limits; the page itself may still work.
    results = await browser.scripting.executeScript({ target: { tabId }, files: [VIDEO_SCRIPT] });
  }
  return results.reduce((sum, frame) => sum + ((frame.result as { videos?: number } | undefined)?.videos ?? 0), 0);
}
