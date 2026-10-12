import { defineUnlistedScript } from '#imports';
import { stripThinking } from '@glossa/core';
import { deleteModelAllInfoInCache, hasModelInCache, MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm';
import type { OffscreenReply, OffscreenRequest, OnDeviceStatus, WorkerReply, WorkerRequest } from '@/lib/on-device';
import { findOnDeviceModel, webLlmAppConfig, type OnDeviceModel } from '@/lib/on-device-models';

/**
 * Runs Glossa's on-device model with WebLLM. Started as a worker by the offscreen document
 * (entrypoints/offscreen), which relays requests from the background worker.
 */
export default defineUnlistedScript({
  // Offscreen documents are a Chrome feature; Firefox gets no on-device model yet.
  exclude: ['firefox'],
  main() {
    const scope = self as unknown as {
      onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
      postMessage(message: WorkerReply): void;
    };
    scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
      const { id, request } = event.data;
      handle(request).then(
        (data) => scope.postMessage({ id, reply: { ok: true, data } } satisfies WorkerReply),
        (error: unknown) =>
          scope.postMessage({
            id,
            reply: { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies OffscreenReply,
          } satisfies WorkerReply),
      );
    };
  },
});

/** Frees GPU memory when the model hasn't been used for this long. */
const IDLE_UNLOAD_MS = 10 * 60_000;

// Workers have no extension APIs, but share the extension's origin.
const appConfig = webLlmAppConfig((path) => new URL(path, self.location.origin).href);

interface GpuSupport {
  supported: boolean;
  reason?: string;
  f16: boolean;
}

interface WebGpu {
  requestAdapter(): Promise<{ features: ReadonlySet<string> } | null>;
}

let gpuCheck: Promise<GpuSupport> | undefined;
function checkGpu(): Promise<GpuSupport> {
  gpuCheck ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: WebGpu }).gpu;
    if (!gpu) return { supported: false, f16: false, reason: 'This browser doesn’t support WebGPU, which the model needs.' };
    const adapter = await gpu.requestAdapter().catch(() => null);
    if (!adapter) {
      return {
        supported: false,
        f16: false,
        reason: 'No usable graphics card found. Check that hardware acceleration is on in the browser’s settings.',
      };
    }
    return { supported: true, f16: adapter.features.has('shader-f16') };
  })();
  return gpuCheck;
}

/** The WebLLM build this GPU can run, or why there is none. */
async function buildFor(model: OnDeviceModel): Promise<{ id: string } | { error: string }> {
  const gpu = await checkGpu();
  if (!gpu.supported) return { error: gpu.reason! };
  if (gpu.f16) return model.builds.f16;
  if (model.builds.f32) return model.builds.f32;
  return { error: `This graphics card can’t run the ${model.label} model. Choose a smaller one.` };
}

async function buildId(modelId: string): Promise<string> {
  const build = await buildFor(findOnDeviceModel(modelId));
  if ('error' in build) throw new Error(build.error);
  return build.id;
}

interface Loading {
  build: string;
  promise: Promise<void>;
  progress: number;
  phase: 'download' | 'load';
}

let engine: MLCEngine | undefined;
/** The WebLLM build in GPU memory. */
let loaded: string | undefined;
let loading: Loading | undefined;
const errors = new Map<string, string>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function onProgress(report: InitProgressReport): void {
  if (!loading) return;
  loading.progress = report.progress;
  // WebLLM reports "Start to fetch params" and "Fetching param cache…" while downloading, then
  // "Loading model from cache…", "Loading GPU shader modules…" and "Finish loading…".
  loading.phase = /^(Loading|Finish)/.test(report.text) ? 'load' : 'download';
}

function getEngine(): MLCEngine {
  engine ??= new MLCEngine({ appConfig, initProgressCallback: onProgress });
  return engine;
}

function load(build: string): Promise<void> {
  if (loaded === build) return Promise.resolve();
  if (loading?.build === build) return loading.promise;
  errors.delete(build);
  loaded = undefined;
  const entry: Loading = { build, progress: 0, phase: 'download', promise: Promise.resolve() };
  entry.promise = getEngine()
    .reload(build)
    .then(
      () => {
        loaded = build;
        scheduleUnload();
      },
      (error: unknown) => {
        errors.set(build, error instanceof Error ? error.message : String(error));
        throw error;
      },
    )
    .finally(() => {
      if (loading === entry) loading = undefined;
    });
  loading = entry;
  return entry.promise;
}

function scheduleUnload(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (loading || !engine) return;
    loaded = undefined;
    void engine.unload();
  }, IDLE_UNLOAD_MS);
}

async function status(modelId: string): Promise<OnDeviceStatus> {
  const build = await buildFor(findOnDeviceModel(modelId));
  if ('error' in build) return { supported: false, reason: build.error, downloaded: false, ready: false };
  const current = loading?.build === build.id ? loading : undefined;
  return {
    supported: true,
    downloaded: loaded === build.id || (await hasModelInCache(build.id, appConfig)),
    ready: loaded === build.id,
    loading: current && { progress: current.progress, phase: current.phase },
    error: errors.get(build.id),
  };
}

/** Answers one request at a time; WebLLM generates one answer at a time anyway. */
let queue: Promise<unknown> = Promise.resolve();

function complete(modelId: string, system: string, prompt: string): Promise<string> {
  const run = async (): Promise<string> => {
    const build = await buildId(modelId);
    if (loaded !== build && loading?.build !== build && !(await hasModelInCache(build, appConfig))) {
      throw new Error('Download the on-device model in Glossa’s settings first.');
    }
    await load(build);
    clearTimeout(idleTimer);
    try {
      const reply = await getEngine().chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        // Answers are short and factual. Small models wander at high temperatures, and can repeat
        // themselves at low ones, hence the penalties and a cap a little above the 90-word target.
        temperature: 0.4,
        top_p: 0.8,
        presence_penalty: 1,
        frequency_penalty: 0.5,
        max_tokens: 400,
        extra_body: { enable_thinking: false },
      });
      // WebLLM includes the empty thinking block it adds to switch thinking off.
      const text = stripThinking(reply.choices[0]?.message.content ?? '');
      if (!text) throw new Error('The on-device model returned an empty response.');
      return text;
    } finally {
      scheduleUnload();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

async function remove(modelId: string): Promise<null> {
  const model = findOnDeviceModel(modelId);
  for (const build of [model.builds.f16, model.builds.f32]) {
    if (!build) continue;
    if (loaded === build.id || loading?.build === build.id) {
      loaded = undefined;
      await engine?.unload();
    }
    errors.delete(build.id);
    await deleteModelAllInfoInCache(build.id, appConfig);
  }
  return null;
}

async function handle(request: OffscreenRequest): Promise<unknown> {
  switch (request.type) {
    case 'status':
      return status(request.model);
    case 'download':
      // Keeps going after this returns; the options page follows along through `status`.
      load(await buildId(request.model)).catch(() => undefined);
      return null;
    case 'complete':
      return complete(request.model, request.system, request.prompt);
    case 'delete':
      return remove(request.model);
  }
}
