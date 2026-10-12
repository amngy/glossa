import type { Cue } from './types';

/** Overlaps up to this many seconds are timing slop, not lines meant to be on screen together. */
const SMALL_OVERLAP = 0.5;

/** Ends each cue where the next one starts, if they overlap by at most `limit` seconds. Cues must be sorted. */
export function clipOverlaps(cues: Cue[], limit: number): void {
  for (let i = 0; i < cues.length - 1; i++) {
    const cue = cues[i]!;
    const next = cues[i + 1]!;
    if (cue.end > next.start && cue.end - next.start <= limit) cue.end = Math.max(cue.start, next.start);
  }
}

/**
 * Manual tracks can show several cues at once, e.g. one row in a window at the top and another at
 * the bottom, or a line that stays while a second one appears under it. Shows those as one cue per
 * stretch of time with all their rows, so a row never hides the ones still on screen.
 * Cues must be sorted by start; small overlaps are clipped first. Shared by every cue source.
 */
export function mergeOverlappingCues(cues: Cue[]): Cue[] {
  clipOverlaps(cues, SMALL_OVERLAP);
  const times = [...new Set(cues.flatMap((cue) => [cue.start, cue.end]))].sort((a, b) => a - b);
  const merged: Cue[] = [];
  let first = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i]!;
    const end = times[i + 1]!;
    while (first < cues.length && cues[first]!.end <= start) first++;
    const rows: string[] = [];
    for (let j = first; j < cues.length && cues[j]!.start <= start; j++) {
      if (cues[j]!.end >= end) rows.push(cues[j]!.text);
    }
    if (rows.length === 0) continue;
    const text = rows.join('\n');
    const previous = merged[merged.length - 1];
    if (previous && previous.text === text && previous.end === start) previous.end = end;
    else merged.push({ start, end, text });
  }
  return merged;
}
