export interface PrimeVideoSubtitle {
  lang: string;
  label: string;
  url: string;
}

/**
 * The subtitle files in a Prime Video `GetVodPlaybackResources` response (TTML), or null when the response
 * has no subtitle listing. Field names follow asbplayer (MIT, github.com/killergerbah/asbplayer).
 */
export function primeVideoSubtitles(response: unknown): PrimeVideoSubtitle[] | null {
  const result = (response as { timedTextUrls?: { result?: { subtitleUrls?: unknown } } } | null)?.timedTextUrls?.result;
  if (!result) return null;
  const tracks = Array.isArray(result.subtitleUrls) ? result.subtitleUrls : [];
  return tracks.flatMap((track): PrimeVideoSubtitle[] =>
    typeof track?.url === 'string' && typeof track.languageCode === 'string'
      ? [{ lang: track.languageCode, label: String(track.displayName ?? track.languageCode), url: track.url }]
      : [],
  );
}
