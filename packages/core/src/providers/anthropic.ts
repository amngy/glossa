import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_ANTHROPIC_MODEL } from './defaults';
import { ProviderError, type ChatModel, type ChatOptions } from './types';

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
/** Models that accept `output_config.effort`. */
const EFFORT_MODELS = /^claude-(?:(?:opus|sonnet|haiku|fable|mythos)-5|opus-4-[5-8])/;

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
}

export class AnthropicChatModel implements ChatModel {
  readonly name = 'Claude';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AnthropicConfig) {
    // Glossa calls this from the extension's background worker, so the key is
    // never exposed to the web pages the extension runs on.
    this.client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    this.model = config.model?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }

  async complete(system: string, prompt: string, { signal }: ChatOptions = {}): Promise<string> {
    try {
      const response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 8000,
          system,
          messages: [{ role: 'user', content: prompt }],
          // Word lookups are simple; low effort keeps answers quick and cheap.
          ...(EFFORT_MODELS.test(this.model) ? { output_config: { effort: 'low' as const } } : {}),
          // On a safety decline, let the API retry on Anthropic's recommended fallback model.
          ...(FALLBACK_MODELS.has(this.model)
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        },
        { signal },
      );

      if (response.stop_reason === 'refusal') {
        throw new ProviderError('Claude declined to answer this request.');
      }
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
        .trim();
      if (!text) throw new ProviderError('Claude returned an empty response.');
      return text;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ProviderError('Claude: the API key was rejected.', 401);
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ProviderError('Claude: rate limited, try again in a moment.', 429);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError(`Claude: ${error.message}`, error.status);
      }
      throw error;
    }
  }
}
