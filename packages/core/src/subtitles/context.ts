import type { SubtitleContext } from '../providers/types';
import type { Cue } from './types';

export interface SubtitleContextOptions {
  /** Most lines to take before the line. */
  before?: number;
  /** Most lines to take after it. */
  after?: number;
  /** A pause longer than this many seconds likely means a new scene, so the context stops there. */
  maxGap?: number;
  /** Most characters in all context lines together, to keep prompts quick for small local models. */
  maxChars?: number;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The lines around `cues[index]`, closest first, for AI translations and explanations.
 * Skips repeats (common in automatic captions) and stops at long pauses.
 */
export function subtitleContext(
  cues: readonly Cue[],
  index: number,
  { before = 3, after = 2, maxGap = 10, maxChars = 400 }: SubtitleContextOptions = {},
): SubtitleContext {
  const context: SubtitleContext = { before: [], after: [] };
  const cue = cues[index];
  if (!cue) return context;

  const seen = new Set([oneLine(cue.text)]);
  let budget = maxChars;
  /** Adds the line if it fits; returns false once the context can't grow on this side. */
  const add = (side: 'before' | 'after', text: string): boolean => {
    if (text.length > budget) return false;
    if (text && !seen.has(text)) {
      seen.add(text);
      budget -= text.length;
      if (side === 'before') context.before.unshift(text);
      else context.after.push(text);
    }
    return true;
  };

  let previous = index - 1;
  let next = index + 1;
  let earliestStart = cue.start;
  let latestEnd = cue.end;
  let growBefore = before > 0;
  let growAfter = after > 0;
  while (growBefore || growAfter) {
    if (growBefore) {
      const line = cues[previous];
      if (!line || earliestStart - line.end > maxGap) growBefore = false;
      else {
        previous--;
        earliestStart = line.start;
        growBefore = add('before', oneLine(line.text)) && context.before.length < before;
      }
    }
    if (growAfter) {
      const line = cues[next];
      if (!line || line.start - latestEnd > maxGap) growAfter = false;
      else {
        next++;
        latestEnd = line.end;
        growAfter = add('after', oneLine(line.text)) && context.after.length < after;
      }
    }
  }
  return context;
}
