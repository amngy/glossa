const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Removes sound descriptions such as "[Music]", "[Aplausos]" or a line that is
 * only "(door slams)", and the music-note symbols around sung lyrics. Square
 * brackets are the convention in any language; parentheses are only dropped
 * when they are the whole line, so ordinary asides in speech survive.
 */
function stripSoundCues(line: string): string {
  const withoutBrackets = line.replace(/\[[^\]]*\]/g, ' ').trim();
  if (/^\([^()]*\)$/.test(withoutBrackets)) return '';
  return withoutBrackets.replace(/[♪♫♬]/g, ' ');
}

/**
 * Normalizes raw cue text: removes markup (VTT voice/class spans, inline
 * timestamps, <i>/<b>) and sound descriptions, decodes entities, and tidies
 * whitespace while keeping intentional line breaks.
 */
export function cleanCueText(raw: string): string {
  return decodeEntities(stripTags(raw))
    .split('\n')
    .map((line) => stripSoundCues(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
