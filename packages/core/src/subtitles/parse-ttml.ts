import { cleanCueText } from './clean';
import { mergeOverlappingCues } from './overlaps';
import type { Cue } from './types';

/** The value of attribute `name` (any namespace prefix) in a tag's attribute text. */
function attribute(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs)?.[2];
}

/**
 * Parses TTML, DFXP and IMSC (Prime Video's and Netflix's format) without a DOM, since this package has
 * no browser APIs. Times may be clock times ("00:01:02.500", "00:01:02:12" in frames) or offsets
 * ("62.5s", "625000000t" in ticks). Ruby readings (tts:ruby="text") are dropped: the overlay adds its own.
 * shortcut: times on a <p> only, not inherited from a parent <div> or <body>; add that if a file needs it.
 */
export function parseTtmlSubtitles(input: string): Cue[] {
  const root = /<(?:[\w-]+:)?tt\b([^>]*)>/.exec(input)?.[1] ?? '';
  const tickRate = Number(attribute(root, 'tickRate')) || 10_000_000;
  const frameRate = (Number(attribute(root, 'frameRate')) || 30) *
    (attribute(root, 'frameRateMultiplier')?.split(/\s+/).map(Number).reduce((a, b) => a / b) || 1);

  const time = (value: string | undefined): number | null => {
    if (!value) return null;
    const clock = /^\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?\s*$/.exec(value);
    if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + Number(clock[4] ?? 0) / frameRate;
    const offset = /^\s*(\d+(?:\.\d+)?)(h|m|s|ms|f|t)\s*$/.exec(value);
    if (!offset) return null;
    // Divide where the unit is a fraction of a second, so ticks give exact times.
    const n = Number(offset[1]);
    const perSecond: Record<string, number> = { ms: 1000, f: frameRate, t: tickRate };
    const seconds: Record<string, number> = { h: 3600, m: 60, s: 1 };
    return offset[2]! in perSecond ? n / perSecond[offset[2]!]! : n * seconds[offset[2]!]!;
  };

  const cues: Cue[] = [];
  for (const [, attrs = '', body = ''] of input.matchAll(/<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p>/g)) {
    const start = time(attribute(attrs, 'begin'));
    const duration = time(attribute(attrs, 'dur'));
    const end = time(attribute(attrs, 'end')) ?? (start !== null && duration !== null ? start + duration : null);
    if (start === null || end === null || end <= start) continue;
    const text = cleanCueText(
      body
        .replace(/<(?:[\w-]+:)?span\b[^>]*ruby\s*=\s*["']text["'][^>]*>[\s\S]*?<\/(?:[\w-]+:)?span>/g, '')
        // Source line breaks are only layout; <br/> is the line break.
        .replace(/\s*\n\s*/g, ' ')
        .replace(/<(?:[\w-]+:)?br\b[^>]*>/g, '\n'),
    );
    if (text) cues.push({ start, end, text });
  }
  return mergeOverlappingCues(cues.sort((a, b) => a.start - b.start));
}
