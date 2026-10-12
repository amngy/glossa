import { cleanCueText } from './clean';
import { mergeOverlappingCues } from './overlaps';
import type { Cue } from './types';

/** Parses "hh:mm:ss.mmm", "mm:ss.mmm" or the SRT form "hh:mm:ss,mmm" into seconds. */
export function parseTimestamp(value: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(value);
  if (!match) return null;
  const [, h = '0', m = '0', s = '0', ms = '0'] = match;
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
  );
}

/**
 * Parses WebVTT or SRT. Both formats share the "start --> end" timing line
 * followed by text lines up to a blank line, so one parser handles both.
 * Header, NOTE, STYLE and REGION blocks are skipped because they contain no
 * timing line.
 */
export function parseTextSubtitles(input: string): Cue[] {
  const lines = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues: Cue[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const arrow = line.indexOf('-->');
    i++;
    if (arrow === -1) continue;

    const start = parseTimestamp(line.slice(0, arrow));
    // VTT allows cue settings after the end time ("00:01.000 align:start").
    const end = parseTimestamp(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? '');

    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      textLines.push(lines[i]!);
      i++;
    }

    if (start === null || end === null) continue;
    const text = cleanCueText(textLines.join('\n'));
    if (text) cues.push({ start, end, text });
  }

  return mergeOverlappingCues(cues.sort((a, b) => a.start - b.start));
}
