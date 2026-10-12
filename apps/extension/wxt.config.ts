import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'Glossa',
    description:
      'Interactive dual-language subtitles for language learners. Click any word for its translation, definition and an explanation.',
    // declarativeNetRequestWithHostAccess: lets Glossa's own requests reach
    // self-hosted servers like Ollama (see lib/server-rules.ts). It only works
    // on hosts Glossa has permission for, so it adds no install warning.
    // offscreen + unlimitedStorage (Chrome): run the on-device model and keep
    // its downloaded weights. Neither adds an install warning in Chrome.
    // activeTab + scripting: start subtitles for any page's video from the popup,
    // only on the tab where the viewer asks. Neither adds an install warning.
    permissions: [
      'storage',
      'declarativeNetRequestWithHostAccess',
      'activeTab',
      'scripting',
      ...(browser === 'firefox' ? [] : ['offscreen', 'unlimitedStorage']),
    ],
    // tabCapture is requested when the viewer first transcribes a tab's audio (see entrypoints/popup).
    ...(browser === 'firefox' ? {} : { optional_permissions: ['tabCapture'] }),
    // The on-device models run as WebAssembly.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Free dictionary lookups. Everything else (translation/AI servers you
    // configure) is requested at runtime for just that server.
    host_permissions: ['https://en.wiktionary.org/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: '{4f6f1c2e-8a7b-4c39-9d0e-6b2f3a1c5e77}', strict_min_version: '128.0' },
          },
        }
      : {}),
  }),
  // `pnpm dev` opens a fresh browser profile with the extension loaded. Put
  // personal overrides (browser binary, profile) in web-ext.config.ts.
  webExt: {
    startUrls: ['https://www.youtube.com/'],
  },
  vite: () => ({
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
    resolve: {
      // transformers.js asks for the WebGPU build of ONNX Runtime. Speech recognition runs on the CPU, and
      // this smaller build avoids shipping a 28 MB WebGPU runtime.
      alias: { 'onnxruntime-web/webgpu': 'onnxruntime-web/wasm' },
    },
  }),
  hooks: {
    // The on-device model is Chrome-only for now, so Firefox builds skip its GPU code.
    'build:publicAssets': (wxt, files) => {
      if (wxt.config.browser !== 'firefox') return;
      for (let i = files.length - 1; i >= 0; i--) {
        // Paths use the OS separator.
        if (/^(webllm|ort)[\\/]/.test(files[i]!.relativeDest)) files.splice(i, 1);
      }
    },
  },
});
