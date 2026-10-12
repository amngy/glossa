import {
  AnthropicChatModel,
  BrowserLanguageModel,
  DeepLTranslator,
  LibreTranslateTranslator,
  LlmTranslator,
  OpenAICompatibleChatModel,
  type ChatModel,
  type Translator,
} from '@glossa/core';
import { OnDeviceChatModel } from './on-device-client';
import { getSecrets, getSettings } from './settings';

/** Kept for the worker's lifetime: it reuses sessions between requests. */
const builtInModel = new BrowserLanguageModel();

/** Builds the configured AI model, or returns null if AI is turned off. Background worker only. */
export async function createChatModel(): Promise<ChatModel | null> {
  const [settings, secrets] = await Promise.all([getSettings(), getSecrets()]);
  const { provider, model, baseUrl } = settings.ai;

  switch (provider) {
    case 'built-in':
      return builtInModel;
    case 'on-device':
      return new OnDeviceChatModel(settings.ai.onDeviceModel);
    case 'anthropic':
      if (!secrets.anthropicApiKey) throw new Error('Add your Anthropic API key in Glossa’s settings.');
      return new AnthropicChatModel({ apiKey: secrets.anthropicApiKey, model });
    case 'openai-compatible':
      if (!baseUrl || !model) throw new Error('Set the server URL and model name in Glossa’s settings.');
      return new OpenAICompatibleChatModel({ baseUrl, model, apiKey: secrets.openaiCompatibleApiKey });
    case 'none':
      return null;
  }
}

/** Builds the configured server-side translator. The built-in browser translator runs in the page instead. */
export async function createTranslator(): Promise<Translator> {
  const [settings, secrets] = await Promise.all([getSettings(), getSecrets()]);

  switch (settings.translator) {
    case 'deepl':
      if (!secrets.deeplApiKey) throw new Error('Add your DeepL API key in Glossa’s settings.');
      return new DeepLTranslator(secrets.deeplApiKey);
    case 'libretranslate':
      return new LibreTranslateTranslator({
        url: settings.libreTranslateUrl,
        apiKey: secrets.libreTranslateApiKey,
      });
    case 'ai': {
      const model = await createChatModel();
      if (!model) throw new Error('Choose an AI provider in Glossa’s settings to translate with AI.');
      return new LlmTranslator(model);
    }
    case 'browser':
      throw new Error('The built-in browser translator only runs inside web pages.');
  }
}

/** Turns the browser's opaque network errors into something actionable. */
export function describeNetworkError(error: unknown): Error {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new Error(
      'Glossa couldn’t reach the server. Check the URL in settings and that the server is running, then save settings again to grant access.',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
