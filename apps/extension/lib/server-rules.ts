import { browser, type Browser } from 'wxt/browser';
import type { Settings } from './settings';

const RULE_ID = 1;
/** `tabs.TAB_ID_NONE`: requests that don't come from a tab, here Glossa's background worker. */
const TAB_ID_NONE = -1;

/** Self-hosted servers the user set up. Anything Glossa talks to that might check the Origin header. */
function serverHosts(settings: Settings): string[] {
  const urls = [
    settings.ai.provider === 'openai-compatible' ? settings.ai.baseUrl : '',
    settings.translator === 'libretranslate' ? settings.libreTranslateUrl : '',
  ];
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      if (url) hosts.add(new URL(url).hostname);
    } catch {
      // not a valid URL yet
    }
  }
  return [...hosts];
}

/**
 * Removes the Origin header from Glossa's own requests to the user's self-hosted servers.
 *
 * Ollama (and some other local servers) reject requests whose Origin they don't know, and browsers
 * send `chrome-extension://…` for an extension's requests. Without this, people would have to set
 * OLLAMA_ORIGINS and restart Ollama. The rule only matches requests made by this extension outside
 * any tab, so web pages (and their service workers) still send their Origin and stay blocked.
 * Session rules are cleared when the browser restarts, so this runs whenever the worker starts.
 */
export async function syncServerRules(settings: Settings): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  const hosts = serverHosts(settings);
  const ownHost = new URL(browser.runtime.getURL('/')).hostname;
  const rule = {
    id: RULE_ID,
    priority: 1,
    condition: { requestDomains: hosts, initiatorDomains: [ownHost], tabIds: [TAB_ID_NONE] },
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'origin', operation: 'remove' }],
    },
  } as unknown as Browser.declarativeNetRequest.Rule;
  try {
    await dnr.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: hosts.length > 0 ? [rule] : [] });
  } catch (error) {
    // Not fatal: the request then fails with a 403 that explains OLLAMA_ORIGINS.
    console.warn('Glossa: could not set up access to self-hosted servers.', error);
  }
}
