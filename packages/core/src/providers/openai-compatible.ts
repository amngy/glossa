import { ProviderError, type ChatModel, type ChatOptions } from './types';

export interface OpenAICompatibleConfig {
  /**
   * API root that serves `/chat/completions`, e.g. "http://localhost:11434/v1"
   * for Ollama, "http://localhost:1234/v1" for LM Studio, or any hosted
   * OpenAI-compatible service.
   */
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/**
 * Cleans up a server URL as people tend to type it. OpenAI-compatible APIs live under `/v1`
 * (Ollama, LM Studio, vLLM, OpenAI), so a bare address like "http://localhost:11434/" gets `/v1`.
 * URLs with a path, like "https://openrouter.ai/api/v1", are kept as they are.
 */
export function normalizeOpenAIBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    return parsed.pathname === '/' && !parsed.search ? `${trimmed}/v1` : trimmed;
  } catch {
    return trimmed;
  }
}

/** Ollama's own API root (without `/v1`) when `baseUrl` points at Ollama's default port, else null. */
export function ollamaApiRoot(baseUrl: string): string | null {
  try {
    const url = new URL(normalizeOpenAIBaseUrl(baseUrl));
    if (url.port !== '11434') return null;
    return `${url.origin}${url.pathname.replace(/\/v1$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * Context window asked of Ollama. Subtitle prompts are short, and Ollama otherwise uses its own
 * setting, which can be so large (up to 256k) that the model no longer fits in GPU memory and runs
 * many times slower on the CPU.
 */
const OLLAMA_CONTEXT = 4096;
/** Stops a model that rambles (some small ones loop) long before a subtitle answer would end. */
const MAX_REPLY_TOKENS = 1024;

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  message?: { content?: string };
  error?: { message?: string } | string;
} | null;

/** Generic chat-completions client, mainly for local/self-hosted models. */
export class OpenAICompatibleChatModel implements ChatModel {
  readonly name: string;
  /** Set once a server rejects `temperature` (some reasoning models only accept their default). */
  private skipTemperature = false;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.name = config.model;
  }

  async complete(system: string, prompt: string, options: ChatOptions = {}): Promise<string> {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const ollama = ollamaApiRoot(this.config.baseUrl);
    // Ollama's own API can turn off "thinking" and set the context size; its OpenAI one can't.
    if (ollama) {
      return this.request(`${ollama}/api/chat`, {
        model: this.config.model,
        messages,
        stream: false,
        think: false,
        options: { num_ctx: OLLAMA_CONTEXT, num_predict: MAX_REPLY_TOKENS, ...(options.temperature !== undefined ? { temperature: options.temperature } : {}) },
      }, options.signal);
    }

    const body = { model: this.config.model, messages, stream: false };
    const withTemperature = options.temperature !== undefined && !this.skipTemperature;
    try {
      return await this.request(
        `${normalizeOpenAIBaseUrl(this.config.baseUrl)}/chat/completions`,
        withTemperature ? { ...body, temperature: options.temperature } : body,
        options.signal,
      );
    } catch (error) {
      if (!(withTemperature && error instanceof ProviderError && error.status === 400 && /temperature/i.test(error.message))) throw error;
      this.skipTemperature = true;
      return this.request(`${normalizeOpenAIBaseUrl(this.config.baseUrl)}/chat/completions`, body, options.signal);
    }
  }

  private async request(url: string, body: object, signal: AbortSignal | undefined): Promise<string> {
    const { apiKey, model } = this.config;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    const data = (await response.json().catch(() => null)) as ChatResponse;

    if (!response.ok) {
      const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
      if (response.status === 403 && !detail) {
        // Ollama answers 403 with an empty body when the request's Origin isn't on its OLLAMA_ORIGINS list.
        throw new ProviderError(
          `${model}: the server refused the request (403). If this is Ollama, allow this app in its OLLAMA_ORIGINS setting.`,
          403,
        );
      }
      throw new ProviderError(`${model}: ${detail ?? `request failed (${response.status})`}`, response.status);
    }
    const text = (data?.choices?.[0]?.message?.content ?? data?.message?.content)?.trim();
    if (!text) throw new ProviderError(`${model} returned an empty response.`);
    return text;
  }
}
