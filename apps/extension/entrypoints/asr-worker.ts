import { defineUnlistedScript } from '#imports';
import { env, pipeline } from '@huggingface/transformers';
import type { AsrWorkerReply, AsrWorkerRequest } from '@/lib/asr';
import { PACKS, readPackFile } from '@/lib/packs';

/**
 * Runs Whisper (transformers.js with ONNX Runtime on the CPU, as WebAssembly) on this device. Started
 * as a worker by the offscreen document. The model files come from the installed speech pack in the
 * extension's own storage; nothing is requested from the network.
 */

/** Model files are asked for as `<POOL><pack id>/<file>` and answered from the pack. */
const POOL = 'https://glossa-pack.invalid/';

export default defineUnlistedScript({
  exclude: ['firefox'],
  main() {
    env.allowLocalModels = false;
    env.remoteHost = POOL;
    env.remotePathTemplate = '{model}/';
    env.useBrowserCache = false;
    env.useWasmCache = false;
    env.fetch = async (input) => {
      const url = String(input);
      const [id, ...path] = url.startsWith(POOL) ? url.slice(POOL.length).split('/') : [];
      const pack = PACKS.find((candidate) => candidate.id === id);
      const bytes = pack && (await readPackFile(pack, path.join('/')));
      return bytes ? new Response(bytes) : new Response(null, { status: 404, statusText: 'Not installed' });
    };
    // The WebAssembly runtime ships inside the extension: extensions can't run code downloaded at runtime.
    // One thread: multiple threads need cross-origin isolation, which extension pages don't have.
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.wasmPaths = {
      // Workers have no chrome.runtime; they run at the extension's own origin.
      mjs: new URL('/ort/ort-wasm-simd-threaded.mjs', self.location.href).href,
      wasm: new URL('/ort/ort-wasm-simd-threaded.wasm', self.location.href).href,
    };

    const scope = self as unknown as {
      onmessage: ((event: MessageEvent<AsrWorkerRequest>) => void) | null;
      postMessage(message: AsrWorkerReply): void;
    };
    type Transcriber = (
      samples: Float32Array,
      options: Record<string, unknown>,
    ) => Promise<{ chunks?: { timestamp: [number, number | null]; text: string }[]; text: string }>;
    let transcriber: Promise<Transcriber> | undefined;

    const fail = (error: unknown, id?: number) =>
      scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });

    scope.onmessage = async (event) => {
      const request = event.data;
      if (request.type === 'load') {
        transcriber = pipeline('automatic-speech-recognition', request.pack, { dtype: 'q8', device: 'wasm' }) as unknown as Promise<Transcriber>;
        transcriber.then(() => scope.postMessage({ type: 'ready' }), (error: unknown) => fail(error));
        return;
      }
      try {
        if (!transcriber) throw new Error('The speech model isn’t loaded.');
        const result = await (await transcriber)(request.samples, {
          language: request.language || undefined,
          task: 'transcribe',
          return_timestamps: true,
        });
        const chunks = (result.chunks ?? [{ timestamp: [0, null] as [number, number | null], text: result.text }]).map((chunk) => ({
          start: chunk.timestamp[0],
          end: chunk.timestamp[1],
          text: chunk.text,
        }));
        scope.postMessage({ type: 'lines', id: request.id, chunks });
      } catch (error) {
        fail(error, request.id);
      }
    };
  },
});
