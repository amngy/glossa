export * from './subtitles/types';
export { cleanCueText, decodeEntities, stripTags } from './subtitles/clean';
export { parseTextSubtitles, parseTimestamp } from './subtitles/parse-text';
export { parseAssSubtitles } from './subtitles/parse-ass';
export { parseYouTubeJson3 } from './subtitles/parse-youtube';
export { mergeOverlappingCues } from './subtitles/overlaps';
export { findActiveCueIndex, findBestOverlap, findCueIndexAtOrBefore } from './subtitles/cue-index';
export { subtitleContext, type SubtitleContextOptions } from './subtitles/context';

export { tokenize, normalizeWord, type Token } from './text/segment';
export { baseLanguage, languageName, languageFromFileName, languageFromSubtitleCode, COMMON_LANGUAGES } from './text/language';
export { pickVoice, type VoiceLike } from './text/voice';
export { rubyIn, rubyParts, rubySpans, type ReadingToken, type RubyPart, type RubySpan } from './text/ruby';
export { chineseReadings } from './text/pinyin';
export { romajiSpans } from './text/romaji';

export { LiveLine, type LiveText } from './asr/live';
export { endsSentence, joinSentences, joinText, type SentenceOptions } from './asr/sentences';
export {
  addTranscribedCues,
  Endpointer,
  HeardSpans,
  MediaClock,
  mixToMono,
  placeSpokenLines,
  segmentsToCues,
  type EndpointOptions,
  type SpokenLine,
  type Utterance,
} from './asr/transcribe';
export { isWebmInit, WebmDemuxer, type WebmFrame, type WebmTrack } from './asr/webm';
export { localSpeechTag, startLocalOnly, type LocalRecognizer } from './asr/local-speech';

export {
  COMPANION_HOST,
  decodePcm,
  encodePcm,
  parseCompanionReply,
  type CompanionReply,
  type CompanionRequest,
} from './asr/companion';

export * from './providers/types';
export { WiktionaryDictionary, parseWiktionaryResponse } from './providers/wiktionary';
export { LlmDictionary, parseDictionaryReply } from './providers/llm-dictionary';
export { LibreTranslateTranslator, type LibreTranslateConfig } from './providers/libretranslate';
export { DeepLTranslator, deeplTargetLanguage } from './providers/deepl';
export {
  BrowserTranslator,
  isBrowserTranslatorSupported,
  type BrowserTranslatorAvailability,
} from './providers/browser-translator';
export {
  BrowserLanguageModel,
  browserLanguageModelAvailability,
  downloadBrowserLanguageModel,
  isBrowserLanguageModelSupported,
  type BrowserModelAvailability,
} from './providers/browser-language-model';
export { AnthropicChatModel, type AnthropicConfig } from './providers/anthropic';
export { DEFAULT_ANTHROPIC_MODEL } from './providers/defaults';
export {
  OpenAICompatibleChatModel,
  normalizeOpenAIBaseUrl,
  type OpenAICompatibleConfig,
} from './providers/openai-compatible';
export { LlmExplainer, LlmTranslator, cleanTranslation, stripThinking } from './providers/llm';
export {
  TRANSLATOR_SYSTEM_PROMPT,
  DICTIONARY_SYSTEM_PROMPT,
  TUTOR_SYSTEM_PROMPT,
  buildDictionaryPrompt,
  buildExplainPrompt,
  buildTranslatePrompt,
  tutorSystemPrompt,
} from './providers/prompts';

export { LruCache } from './cache';
export { toCsv, toAnkiTsv, type SavedWord } from './vocab';
