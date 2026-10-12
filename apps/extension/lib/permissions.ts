import { browser } from '#imports';
import type { Settings } from './settings';

/** "https://example.com:8080/page" → "https://example.com/*", or null for non-web URLs. */
export function originPattern(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    // Match patterns ignore ports, so this covers e.g. localhost:11434 too.
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

/** Host permissions the current translator and AI settings need. */
export function requiredOrigins(settings: Settings): string[] {
  const origins = new Set<string>();
  if (settings.translator === 'libretranslate') {
    const origin = originPattern(settings.libreTranslateUrl);
    if (origin) origins.add(origin);
  }
  if (settings.translator === 'deepl') {
    origins.add('https://api.deepl.com/*');
    origins.add('https://api-free.deepl.com/*');
  }
  if (settings.ai.provider === 'anthropic') origins.add('https://api.anthropic.com/*');
  if (settings.ai.provider === 'openai-compatible') {
    const origin = originPattern(settings.ai.baseUrl);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

/**
 * Asks for access to just the servers in use. Must be called directly from a
 * click handler, before any `await`, because browsers require a user gesture.
 */
export function requestOrigins(origins: string[]): Promise<boolean> {
  if (origins.length === 0) return Promise.resolve(true);
  return browser.permissions.request({ origins });
}
