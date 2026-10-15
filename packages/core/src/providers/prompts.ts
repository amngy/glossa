import { baseLanguage, languageName } from '../text/language';
import type { ExplainRequest, SubtitleContext, TranslationRequest } from './types';

export const TUTOR_SYSTEM_PROMPT = `You are a language tutor built into a subtitle reader. A learner watching a video tapped a word or a subtitle line and wants a quick explanation.

Write for someone glancing at a paused video: short and concrete, with no preamble or sign-off. Use plain text without Markdown headings or bold; short lines and "• " bullets are fine. Stay under 90 words.`;

/** The tutor prompt for answers in `explainIn`. Small models follow the language best when it's set here too. */
export function tutorSystemPrompt(explainIn: string): string {
  return `${TUTOR_SYSTEM_PROMPT}\n\nAlways write your answer in ${languageName(explainIn)}, whatever language the video is in.`;
}

/**
 * "Answer in <language>", written in that language. Small models tend to answer in English when told
 * in English to use another language, but follow the request when it's in the language itself.
 */
const ANSWER_IN: Record<string, string> = {
  ar: 'أجب باللغة العربية.',
  cs: 'Odpověz česky.',
  da: 'Svar på dansk.',
  de: 'Antworte auf Deutsch.',
  el: 'Απάντησε στα ελληνικά.',
  es: 'Responde en español.',
  fi: 'Vastaa suomeksi.',
  fr: 'Réponds en français.',
  he: 'ענה בעברית.',
  hi: 'हिंदी में उत्तर दें।',
  hu: 'Válaszolj magyarul.',
  id: 'Jawab dalam bahasa Indonesia.',
  it: 'Rispondi in italiano.',
  ja: '日本語で答えてください。',
  ko: '한국어로 답하세요.',
  nb: 'Svar på norsk.',
  nl: 'Antwoord in het Nederlands.',
  no: 'Svar på norsk.',
  pl: 'Odpowiedz po polsku.',
  pt: 'Responda em português.',
  ro: 'Răspunde în limba română.',
  ru: 'Отвечай по-русски.',
  sv: 'Svara på svenska.',
  th: 'ตอบเป็นภาษาไทย',
  tr: 'Türkçe cevap ver.',
  uk: 'Відповідай українською.',
  vi: 'Trả lời bằng tiếng Việt.',
  zh: '请用中文回答。',
};

/** Asks for the answer in `lang`, in English and, when known, in that language too. */
function answerIn(lang: string, what = 'explanation'): string {
  const instruction = `Write the ${what} in ${languageName(lang)}.`;
  const native = ANSWER_IN[baseLanguage(lang)];
  return native ? `${instruction} ${native}` : instruction;
}

export const TRANSLATOR_SYSTEM_PROMPT = `You are a professional subtitle translator. Translate the way a native speaker would say it in this scene: natural and idiomatic, never word for word.
- Keep the meaning, tone and register (casual, polite, rude, childish).
- Translate set phrases, greetings, idioms and sound words by what they mean in the situation, not literally.
- Japanese, Korean and Chinese often leave out who does what. Work it out from the nearby lines and add the words the translation needs.
- Use the nearby lines to pick the right meaning of words that have several, and to tell who a title like "sensei" refers to.
- A line can be just part of a sentence that goes on in the next line. Then translate only that part.
- Keep people's names, written in the target language's script.
Reply with the translation only: no quotes, notes, explanations or alternatives.`;

export const DICTIONARY_SYSTEM_PROMPT = `You are a dictionary built into a subtitle reader. A learner tapped a word and wants its dictionary entry.
Reply with one line per common meaning, each written as: part of speech | short definition
- Most words need one line; never more than three. Don't add lines for grammar notes.
- If the word is an inflected form (a conjugated verb, a plural, a case ending), give its base form first: "verb | form of <base form>: <meaning of the base form>". Work out the base form carefully from the word's ending.
- Example for Spanish "dijeron", in English: verb | form of decir: to say
- Keep each definition under 15 words.
- If you don't know the word, reply with "unknown".
No other text, no Markdown.`;

export function buildDictionaryPrompt(word: string, lang: string, definitionLanguage: string): string {
  return [
    `Language: ${languageName(lang)}`,
    `Word: "${word}"`,
    answerIn(definitionLanguage, 'definitions'),
  ].join('\n');
}

function quoted(label: string, lines: readonly string[] | undefined): string[] {
  return lines?.length ? [label, ...lines.map((line) => `"${line}"`)] : [];
}

function hasContext(context: SubtitleContext | undefined): boolean {
  return !!(context?.before.length || context?.after.length);
}

/** The subtitle line, framed by the lines around it when there are any. */
function lineWithContext(sentence: string, context: SubtitleContext | undefined): string[] {
  return [
    ...quoted('Lines before:', context?.before),
    `Subtitle line: "${sentence}"`,
    ...quoted('Lines after:', context?.after),
  ];
}

export function buildExplainPrompt(request: ExplainRequest): string {
  const videoLanguage = languageName(request.lang);
  const explainIn = languageName(request.explainIn);
  const contextNote = hasContext(request.context)
    ? ['The lines before and after are only there so you understand the situation.']
    : [];

  if (request.kind === 'word') {
    return [
      `Video language: ${videoLanguage}`,
      ...lineWithContext(request.sentence, request.context),
      `Word: "${request.word}" (in the subtitle line)`,
      '',
      `In ${explainIn}, explain:`,
      `• what "${request.word}" means in this line`,
      '• its dictionary form, and the grammar of this form (tense, person, case, gender…) when relevant',
      '• anything else a learner should notice here (idiom, register, false friend), only if genuinely useful',
      ...contextNote,
      answerIn(request.explainIn),
    ].join('\n');
  }

  return [
    `Video language: ${videoLanguage}`,
    ...lineWithContext(request.sentence, request.context),
    '',
    // Glossa already shows the line's translation (and a line in the viewer's own language needs none), so don't repeat it.
    baseLanguage(request.lang) === baseLanguage(request.explainIn)
      ? `In ${explainIn}: explain the idioms, slang, wordplay or grammar in this line that a learner might miss. Don't restate or rephrase the whole line.`
      : `The viewer already sees a translation of this line, so don't translate it. In ${explainIn}: briefly explain its grammar and any idioms or slang a learner might miss, quoting the words you explain.`,
    ...contextNote,
    answerIn(request.explainIn),
  ].join('\n');
}

export function buildTranslatePrompt({ text, from, to, sentence, context }: TranslationRequest): string {
  const source = languageName(from);
  const target = languageName(to);
  if (sentence) {
    return [
      ...quoted('Nearby lines, for context:', [...(context?.before ?? []), ...(context?.after ?? [])]),
      `Subtitle line: "${sentence}"`,
      '',
      `Translate the ${source} word "${text}" into ${target}, with the meaning it has in this line and situation.`,
      `If "${text}" is only part of a longer word or set phrase here (a verb stem, one word of an idiom), translate it as part of that phrase.`,
      `Reply with a short ${target} translation of "${text}" only (a word or a few words), not of the whole line.`,
    ].join('\n');
  }
  // The line to translate goes last, after the context, so small models don't translate the context too.
  return [
    ...quoted('Earlier lines, for context only:', context?.before),
    ...quoted('Later lines, for context only:', context?.after),
    ...(hasContext(context) ? [''] : []),
    hasContext(context)
      ? `Translate only this ${source} subtitle line into ${target}, even if its sentence goes on in the later lines:`
      : `Translate this ${source} subtitle line into ${target}:`,
    text,
  ].join('\n');
}
