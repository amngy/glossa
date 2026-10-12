# Contributing to Glossa

Thanks for helping! Bug reports, translations of the UI, new site integrations and docs fixes are all welcome.

## Getting started

```bash
pnpm install
pnpm dev        # opens Chrome with the extension loaded and hot reload
```

Before opening a pull request, run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Where things go

- **`packages/core`** is code that doesn't need a browser extension: parsing, text processing, providers,
  exports. Anything that could also be used by the future web player or server belongs here. Add a Vitest
  test next to similar ones in `packages/core/test`.
- **`apps/extension`** is browser- and site-specific code. Each site gets its own content script in
  `entrypoints/`.

## Guidelines

- **Privacy first.** Don't add analytics, remote logging, or network requests the user didn't choose.
  A new provider must be opt-in. Ask for its host permission at runtime (see `lib/permissions.ts`), not in
  the manifest.
- **API keys** are read only by the background script (`lib/settings.ts` → `getSecrets`). Content scripts
  must never see them.
- **Keep the default path free.** Glossa must stay useful with no keys and no paid services.
- **Small, focused pull requests** are easiest to review. For larger changes, open an issue first to
  discuss the approach.
- **Match the surrounding code**: TypeScript strict mode, Preact function components, 2-space indentation
  and single quotes (see `.editorconfig`).

## Adding a site

1. Check whether it already works: videos with `<track>` elements are handled on any site by
   `entrypoints/video.content/`. Otherwise, find where the site's subtitles come from: a network request or
   the DOM.
2. Turn them into a `SubtitleTrack` from `@glossa/core`. Add a parser there if the format is new.
3. Add a content script in `apps/extension/entrypoints/` with a controller that extends `SubtitleController`
   (`components/overlay/controller.ts`) and renders the shared `Overlay`. The YouTube integration (an overlay
   inside the site's player) and `video.content` (an overlay placed over any video) are the references.
4. Don't work around a site's DRM or access controls. Glossa only reads subtitles the site already gives
   the viewer.

## License

By contributing, you agree that your contributions are licensed under the
[AGPL-3.0-or-later](LICENSE), like the rest of the project.
