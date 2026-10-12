import type { AppConfig, ModelRecord } from '@mlc-ai/web-llm';

/**
 * Glossa's on-device model: Qwen3.5 (Alibaba, Apache 2.0), which handles many languages well for its
 * size. WebLLM runs it on the GPU. The compiled GPU code ships with the extension (public/webllm,
 * fetched by scripts/fetch-model-libs.mjs); the weights download from Hugging Face when the user asks.
 *
 * The 0.8B size is left out: in testing it got basic grammar wrong and repeated itself, which is
 * worse than no explanation for a learner.
 */
export interface OnDeviceModel {
  /** Stored in settings. */
  id: string;
  label: string;
  name: string;
  /** Download size in GB. */
  size: number;
  description: string;
  /**
   * WebLLM builds with 16-bit math, which most GPUs support, and with 32-bit math for the rest.
   * Each is pinned to a Hugging Face revision so the weights always match the bundled GPU code.
   */
  builds: { f16: WebLlmBuild; f32?: WebLlmBuild };
}

interface WebLlmBuild {
  id: string;
  revision: string;
  vramMB: number;
}

export const ON_DEVICE_MODELS: readonly OnDeviceModel[] = [
  {
    id: 'qwen3.5-2b',
    label: 'Standard',
    name: 'Qwen3.5 2B',
    size: 1.1,
    description: 'Good translations and quick answers; grammar details are sometimes off.',
    builds: {
      f16: { id: 'Qwen3.5-2B-q4f16_1-MLC', revision: 'dd74e9c8a20c4546df85c844103bff87b6dcacad', vramMB: 2246 },
      f32: { id: 'Qwen3.5-2B-q4f32_1-MLC', revision: 'd835e5c41aa56174d915e8a3940cde599d3f5a30', vramMB: 2592 },
    },
  },
  {
    id: 'qwen3.5-4b',
    label: 'Large',
    name: 'Qwen3.5 4B',
    size: 2.4,
    description: 'Clearly better explanations. Needs a graphics card with at least 4 GB of memory.',
    builds: {
      f16: { id: 'Qwen3.5-4B-q4f16_1-MLC', revision: '44b42469f9e192814bfd90440e3b377d89ba7a13', vramMB: 3868 },
    },
  },
];

export const DEFAULT_ON_DEVICE_MODEL = 'qwen3.5-2b';

export function findOnDeviceModel(id: string): OnDeviceModel {
  return ON_DEVICE_MODELS.find((model) => model.id === id) ?? ON_DEVICE_MODELS.find((model) => model.id === DEFAULT_ON_DEVICE_MODEL)!;
}

/** WebLLM's settings for every build, with the GPU code loaded from inside the extension. */
export function webLlmAppConfig(extensionUrl: (path: string) => string): AppConfig {
  const builds = ON_DEVICE_MODELS.flatMap((model) => (model.builds.f32 ? [model.builds.f16, model.builds.f32] : [model.builds.f16]));
  const records: ModelRecord[] = builds.map((build) => ({
    model: `https://huggingface.co/mlc-ai/${build.id}/resolve/${build.revision}/`,
    model_id: build.id,
    model_lib: extensionUrl(`/webllm/${build.id.replace(/-MLC$/, '')}_cs1k-webgpu.wasm`),
    vram_required_MB: build.vramMB,
    low_resource_required: false,
    // Glossa's prompts are short; a smaller window needs less GPU memory.
    overrides: { context_window_size: 4096 },
  }));
  return { model_list: records, cacheBackend: 'cache' };
}
