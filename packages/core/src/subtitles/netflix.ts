/** The subtitle format Netflix offers as plain WebVTT, when the manifest request asks for it. */
export const NETFLIX_WEBVTT = 'webvtt-lssdh-ios8';

// Profiles Netflix's manifest request asks for; the list that holds them is where WebVTT is added.
const KNOWN_PROFILES = new Set(['heaac-2-dash', 'dfxp-ls-sdh', 'simplesdh', 'nflx-cmisc', 'imsc1.1']);

export interface NetflixTextTrack {
  lang: string;
  url: string;
  closedCaptions: boolean;
}

/**
 * Adds WebVTT to the profiles in a manifest request about to be sent, and says whether it did.
 * Netflix renames these fields often, so the list is found by what's in it (as subadub does, MIT).
 */
export function addNetflixWebVtt(request: unknown): boolean {
  const find = (value: unknown, depth: number): unknown[] | null => {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) && (key === 'profiles' || child.some((item) => KNOWN_PROFILES.has(item)))) return child;
      const found = find(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const profiles = find(request, 0);
  if (!profiles || profiles.includes(NETFLIX_WEBVTT)) return false;
  profiles.unshift(NETFLIX_WEBVTT);
  return true;
}

/** The movie ID and WebVTT text tracks in a parsed manifest response, or null if `value` isn't one. */
export function netflixTextTracks(value: unknown): { movie: string; tracks: NetflixTextTrack[] } | null {
  const result = (value as { result?: { movieId?: unknown; textTracks?: unknown } } | null)?.result;
  if (!result?.movieId || !Array.isArray(result.textTracks)) return null;
  const tracks = result.textTracks.flatMap((track): NetflixTextTrack[] => {
    if (!track || track.isForcedNarrative || track.isNoneTrack || track.isImageBased) return [];
    // `urls` has been an array of { url } and an object of URLs by CDN.
    const first: unknown = Object.values(track.downloadables?.[NETFLIX_WEBVTT]?.urls ?? {})[0];
    const url = typeof first === 'string' ? first : (first as { url?: unknown } | undefined)?.url;
    const lang: unknown = track.language ?? track.bcp47;
    return typeof url === 'string' && typeof lang === 'string'
      ? [{ lang, url, closedCaptions: track.rawTrackType === 'closedcaptions' }]
      : [];
  });
  return { movie: String(result.movieId), tracks };
}
