import type { Cue } from './types';

/** Index of the last cue whose start is at or before `time`, or -1. Cues must be sorted by start. */
export function findCueIndexAtOrBefore(cues: readonly Cue[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/** Index of the cue on screen at `time`, or -1 if `time` falls in a gap. */
export function findActiveCueIndex(cues: readonly Cue[], time: number): number {
  const index = findCueIndexAtOrBefore(cues, time);
  if (index === -1) return -1;
  return time < cues[index]!.end ? index : -1;
}

/**
 * Finds the cue in `cues` that overlaps [start, end) the most. Used to pair a
 * line with its translation when the two tracks are timed independently.
 */
export function findBestOverlap(cues: readonly Cue[], start: number, end: number): Cue | undefined {
  let index = Math.max(0, findCueIndexAtOrBefore(cues, start));
  let best: Cue | undefined;
  let bestOverlap = 0;
  for (; index < cues.length; index++) {
    const cue = cues[index]!;
    if (cue.start >= end) break;
    const overlap = Math.min(end, cue.end) - Math.max(start, cue.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = cue;
    }
  }
  return best;
}
