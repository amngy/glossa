import { cleanCueText } from './clean';
import { mergeOverlappingCues } from './overlaps';
import { parseTimestamp } from './parse-text';
import type { Cue } from './types';

/**
 * Parses the dialogue of an ASS/SSA file (Crunchyroll's format). Override tags ("{\i1}") are dropped and
 * "\N" becomes a line break. Signs (lines placed with \pos or \move, or styled "Sign" or "…Title") and
 * vector drawings (\p1) are skipped: they translate on-screen text, not speech.
 */
export function parseAssSubtitles(input: string): Cue[] {
  const cues: Cue[] = [];
  let section = '';
  let format: string[] = [];
  for (const raw of input.replace(/^﻿/, '').split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      section = line.toLowerCase();
      continue;
    }
    if (section !== '[events]') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const kind = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (kind === 'format') {
      format = value.split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    if (kind !== 'dialogue' || format.length === 0) continue;

    // Text is the last field and may contain commas.
    const fields = value.split(',');
    const textAt = format.indexOf('text');
    const field = (name: string) => fields[format.indexOf(name)] ?? '';
    const text = fields.slice(textAt).join(',');
    const start = parseTimestamp(field('start'));
    const end = parseTimestamp(field('end'));
    if (textAt === -1 || start === null || end === null || end <= start) continue;
    if (/\{[^}]*\\(pos|move)\(|\{[^}]*\\p[1-9]/.test(text) || /sign|title/i.test(field('style'))) continue;

    const plain = cleanCueText(
      text
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nn]/g, '\n')
        .replace(/\\h/g, ' '),
    );
    if (plain) cues.push({ start, end, text: plain });
  }
  return mergeOverlappingCues(cues.sort((a, b) => a.start - b.start));
}
