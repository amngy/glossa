# Glossa — project guide

Open-source (AGPL) interactive subtitles for language learners: a browser extension (WXT + Preact,
Manifest V3) on top of YouTube and other video sites. Public repo: https://github.com/amngy/glossa.

<!-- Keep this file short. It loads into every session; details belong in the README, issues and git log. -->

## Where things live
- **Open work: [GitHub Issues](https://github.com/amngy/glossa/issues).** Anything the owner flags (a bug,
  an idea, "we should…") becomes an issue right away, with what they said, what you found, which files,
  and any decision made. Don't keep plans, roadmaps or checklists as files in the repo; they go stale.
- **Layout and features:** `README.md` (keep it in sync when behaviour changes). Contributing: `CONTRIBUTING.md`.
- `packages/core`: platform-independent logic, **no browser APIs** (subtitle parsing, segmentation,
  providers, prompts, vocab export). `apps/extension`: everything browser-specific.
- `apps/extension/components/overlay/`: the overlay shared by every site; each site has its own
  controller (`entrypoints/youtube.content/`, `entrypoints/video.content/`) extending `SubtitleController`.

## Communication
Direct and concise: what changed, what was verified (with results), the recommended next step.

## Guardrails
1. **Privacy is the product.** No Glossa server, no analytics, no tracking. A new outgoing request must be
   one the user chose (their translator or AI model) and must be listed in the README's Privacy section.
   API keys stay in `local:secrets` and are only read by the background worker.
2. **AI goes through `ChatModel`** (`packages/core/src/providers/types.ts`); prompts live in `prompts.ts`.
   After any prompt or model-call change, run the translation check and report before/after numbers:
   `pnpm --filter @glossa/core eval <ollama-model…>` (cases in `packages/core/eval/ja-en.json`; the
   pass check is rough, so read the outputs too).
3. **English** for UI strings, code, comments, commits and docs. UI copy is plain and short.
4. **Never commit build output or downloaded model files** (`.output/`, `.wxt/`, `public/webllm/`).

## Sessions, branches, commits
Several Claude sessions may run at once in this folder.
- **Stage by explicit path**, never `git add -A` / `.` / `-u`; "commit all" means the files you edited.
- In a shared checkout, re-check `git symbolic-ref --short HEAD` right before committing; never
  `checkout`, `stash`, `reset` or `rebase` there. For longer work, use a worktree:
  `git worktree add ../glossa-wt-<topic> -b <topic> origin/main` (then `pnpm install` there).
- Before editing a file another session is working on, message that session first.
- Work on a branch (`feat/`, `fix/`, `docs/`, `chore/`) and open a PR with `Closes #N`; the owner merges.
  Don't push to `main` unless the owner asks.
- **Commit messages are the record.** Subject: imperative, ≤ 72 chars. Body: why (the problem, not the
  patch), measurements where they exist (`25/40 → 30/40`, `40 s → 0.2 s per line`), what was rejected
  and why, and what was *not* verified.

## Gates (the same commands CI runs)
```bash
pnpm test && pnpm typecheck && pnpm build
```
A green run in a shared checkout includes other sessions' uncommitted edits: evidence, not proof. Say so.
Overlay changes aren't covered by tests; check them in the browser (`pnpm dev`) or say they weren't.
