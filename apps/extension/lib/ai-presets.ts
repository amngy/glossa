/**
 * Ready-made settings for common OpenAI-compatible servers, so people don't have to look up URLs.
 * Model names change often on hosted services; the hint says where to find the current ones.
 */
export interface OpenAIPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** Suggested model; people can type another. */
  model: string;
  needsKey: boolean;
  hint: string;
}

export const OPENAI_PRESETS: OpenAIPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    needsKey: false,
    hint: 'Free, on your computer. Install a model first, e.g. `ollama pull qwen3:8b`.',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
    hint: 'Free, on your computer. Start the server in LM Studio’s Developer tab and type the model’s name.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    needsKey: true,
    hint: 'Pay per use. Key from platform.openai.com/api-keys.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    needsKey: true,
    hint: 'Has a free tier. Key from aistudio.google.com/apikey.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    needsKey: true,
    hint: 'Very fast, with a free tier. Key from console.groq.com/keys.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    needsKey: true,
    hint: 'Pay per use, with a free tier. Good at European languages. Key from console.mistral.ai.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    needsKey: true,
    hint: 'Pay per use, very cheap, strong at Chinese and Japanese. Key from platform.deepseek.com.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    needsKey: true,
    hint: 'One key for hundreds of models, including Qwen and DeepSeek. Copy a model id from openrouter.ai/models.',
  },
];
