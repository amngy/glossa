// Downloads the compiled WebGPU code for Glossa's on-device models into public/webllm/, so it ships
// inside the extension. Browser extension stores don't allow downloading code at runtime; the model
// weights are data and are downloaded when the user asks for them.
//
// The files come from WebLLM's prebuilt model libraries, pinned to a commit and checked by SHA-256.
// Run automatically before `dev`, `build` and `zip`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4'; // mlc-ai/binary-mlc-llm-libs, for WebLLM 0.2.85
const BASE = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${COMMIT}/web-llm-models/v0_2_84/base`;
const FILES = {
  'Qwen3.5-2B-q4f16_1_cs1k-webgpu.wasm': 'b0f951d411e4fd59fe2af76be9328905ae30549e570a192a841c958b293ecd53',
  'Qwen3.5-4B-q4f16_1_cs1k-webgpu.wasm': '7e8f9895daa710a83952efac4d5c6f36e9f89dc684b25022746d881bdc904712',
  'Qwen3.5-9B-q4f16_1_cs1k-webgpu.wasm': '3014c1d8958083edf621145596a6d7a832178aef2aefe48a0dbde16d38f7c857',
  // For GPUs without 16-bit shader support.
  'Qwen3.5-2B-q4f32_1_cs1k-webgpu.wasm': '0fc73363adf9b9c81f652421138b61bec238a1387b01c8fccffd9d3ea45be9dd',
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'webllm');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
mkdirSync(outDir, { recursive: true });

for (const [name, expected] of Object.entries(FILES)) {
  const path = join(outDir, name);
  if (existsSync(path) && sha256(readFileSync(path)) === expected) continue;
  process.stdout.write(`Downloading ${name}… `);
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expected) throw new Error(`${name}: SHA-256 mismatch (expected ${expected}, got ${actual})`);
  writeFileSync(path, data);
  console.log(`${(data.length / 1e6).toFixed(1)} MB`);
}

// The WebAssembly runtime for speech recognition (ONNX Runtime Web, a dependency of transformers.js)
// also has to ship inside the extension. It comes from node_modules, so the lockfile pins it.
import { copyFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const transformers = realpathSync(createRequire(import.meta.url).resolve('@huggingface/transformers'));
const ortDist = join(transformers.slice(0, transformers.lastIndexOf('node_modules') + 'node_modules'.length), 'onnxruntime-web', 'dist');
const ortOut = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'ort');
mkdirSync(ortOut, { recursive: true });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) copyFileSync(join(ortDist, name), join(ortOut, name));
