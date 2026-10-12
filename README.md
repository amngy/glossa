<p align="center">
  <img src="apps/extension/public/icon/128.png" width="96" height="96" alt="">
</p>

<h1 align="center">Glossa</h1>

<p align="center">
  Open-source interactive subtitles for language learners.<br>
  Watch videos in the language you're learning, and click any word for its translation, definition and an explanation.
</p>

---

Glossa is a free and open-source alternative to tools like LingoPie and Language Reactor. It runs on top of
the video sites you already use, needs no account, and you choose which translation and AI services it
talks to. You can also run every one of those services yourself.

> **Status:** early (v0.1). It works on YouTube, and on any page with an HTML5 video, in Chrome, Edge, Brave
> and Firefox on desktop. Streaming services, a standalone player and mobile support are on the
> [roadmap](#roadmap).

## Features

- **Interactive subtitles.** Glossa replaces YouTube's captions with its own, made of words you can click.
  It uses the video's own subtitles, including auto-generated ones. If a video has none, load a `.srt` or
  `.vtt` file with the file button in Glossa's toolbar.
- **Any video on the web.** On other sites, click Glossa's toolbar button and choose **Subtitles for the
  video on this page**. Glossa uses the video's own subtitle tracks, or a `.srt` or `.vtt` file you load.
  If the page also has subtitles in your language, they become the line translation.
  See [Other sites](#other-sites).
- **Word cards.** Click a word to see its translation, dictionary definitions from Wiktionary (with an
  AI model, a "Look up with AI" button covers words Wiktionary lacks), and, with an AI model, an explanation of what it means
  *in this sentence*: grammar, conjugation, idioms. The model can run on your own computer, free and
  private. The Listen button reads the word aloud with an on-device voice for its language, if you have
  one. Voices that send the text to an online service are never used.
- **Line translation.** Each line's translation is shown below it. You can show it, blur it until you hover,
  or hide it (<kbd>Q</kbd>).
- **Made for studying.** The video pauses while your mouse is over the subtitles. It can also pause
  automatically after every line. Jump to the previous or next line, or replay the current one.
- **Explain a line.** Ask the AI to break down a whole sentence.
- **Saved words.** Star words as you watch. They stay highlighted in later videos. Export them as CSV or
  as an Anki deck, along with the sentence they appeared in.
- **Zero setup by default.** It works out of the box with YouTube's own translations, Chrome's on-device
  translator and Wiktionary. Add DeepL, LibreTranslate or an AI model only if you want them.
- **Private.** No Glossa account, server, analytics or tracking. See [Privacy](#privacy).

### Keyboard shortcuts (while watching)

| Key | Action |
| --- | --- |
| <kbd>A</kbd> | Previous line |
| <kbd>S</kbd> | Replay the current line |
| <kbd>D</kbd> | Next line |
| <kbd>Q</kbd> | Translation: show → blur → hide |
| <kbd>Esc</kbd> | Close the word card |

## Install

Glossa isn't published to any browser extension store: you build it from source. It takes about
two minutes.

You need [Node.js](https://nodejs.org) 22.13 or newer, and [pnpm](https://pnpm.io/installation) 11
(`npm install -g pnpm`).

```bash
git clone <this repository> glossa
cd glossa
pnpm install
pnpm build
```

**Chrome, Edge or Brave:** open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**,
click **Load unpacked**, and choose `apps/extension/.output/chrome-mv3`.

**Firefox:** run `pnpm --filter @glossa/extension build:firefox`. Then open `about:debugging#/runtime/this-firefox`,
click **Load Temporary Add-on**, and choose `apps/extension/.output/firefox-mv3/manifest.json`.
Firefox removes temporary add-ons when it closes, so load it again after a restart.

The settings page opens when you install Glossa. Pick your native language, then open any YouTube video
that has subtitles.

## Translation and AI options

Everything is set up on the settings page. You can open it from the toolbar popup or from the gear icon
under the subtitles.

**Translation** is used for word cards, and for lines when YouTube has no translation of its own. If you pick
DeepL or an AI model, lines are translated with it even when YouTube has a translation, since YouTube's machine
translation often misses the point (Japanese especially); YouTube's version shows while yours loads.

| Option | Cost | Notes |
| --- | --- | --- |
| Built-in browser translator (default) | Free | Runs on your device. Chrome or Edge 138+. Downloads a language pack the first time you use a language pair. |
| [LibreTranslate](https://libretranslate.com) | Free if you host it | Open source. Run it with `docker run -p 5000:5000 libretranslate/libretranslate`, or use any instance. |
| [DeepL](https://www.deepl.com/pro-api) | Free tier: 500k characters per month | High quality. Needs an API key. |
| AI model | Depends on the model | Uses the model you set up below. Good with slang and context. |

**AI explanations** are optional. They explain a word or line in context. The model also sees the few
subtitle lines before and after (within the same scene), so it can tell who "he" is or which meaning of a
word fits. AI translation uses them the same way, and DeepL gets them as context.

| Option | Cost | Notes |
| --- | --- | --- |
| Built into the browser | Free, on your device | Chrome's own model (Gemini Nano). Chrome 138+ on a computer with 22 GB free disk space and a GPU with more than 4 GB of memory or 16 GB of RAM. Writes English, Spanish, Japanese, German and French. |
| Glossa's on-device model | Free, on your device | Downloads [Qwen3.5](https://huggingface.co/Qwen) once and runs it on your graphics card with [WebLLM](https://github.com/mlc-ai/web-llm), even offline. Pick Standard (1.1 GB, recommended), Large (2.4 GB, needs about 4 GB of GPU memory) or Best (5.1 GB, needs about 8 GB). Chrome and Edge only for now. |
| Claude (Anthropic) | Pay per use | Paste an API key from [console.anthropic.com](https://console.anthropic.com). Defaults to Claude Opus 5.5. The best explanations. |
| Ollama, LM Studio or another server | Free if you run it | Any OpenAI-compatible server: [Ollama](https://ollama.com) (`http://localhost:11434`), [LM Studio](https://lmstudio.ai) (`http://localhost:1234/v1`), OpenRouter, a vLLM server, and so on. Good models: `gemma4:e4b` (best in our Japanese test), `qwen3.5:9b` or `qwen3.5:4b`. |

How local models compare on Japanese → English (40 lines and words from
`packages/core/eval/ja-en.json`, through Ollama on an RTX 3070 with 8 GB, October 2026):

| Model | Passed | Median per call |
| --- | --- | --- |
| `gemma4:e4b` | 36 / 40 | 0.2 s |
| `qwen3.5:9b` | 34 / 40 | 0.3 s |
| `qwen2.5:7b` | 29 / 40 | 0.1 s |
| `qwen3.5:4b` | 28 / 40 | 0.2 s |
| `aya-expanse:8b` | 27 / 40 | 0.2 s |
| `deepseek-r1:8b` | 26 / 40 | 5.6 s (it thinks first, and sometimes returns nothing) |

The pass check is rough (it looks for phrases a good translation contains), and some misses are fair
translations, so read the outputs too: `pnpm --filter @glossa/core eval <model>` runs it on your machine.
A smaller Spanish → English set (18 cases, `es-en.json`; run it with `EVAL_SUITE=es-en.json`) gave
`gemma4:e4b` 18, `qwen3.5:9b` 17 and `qwen3.5:4b` 14. Only models served by Ollama have been measured;
Glossa's packaged on-device models are not in these tables yet.

Both sections have a **Test** button. Ollama normally refuses requests from browser extensions; Glossa
handles that for you in Chrome and Edge. If you still get a 403 (for example in Firefox), set the environment
variable `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*` and restart Ollama.

The on-device models aren't part of the extension download, which stays small for people who don't use
them; only their compiled GPU code (about 6 MB per size) ships with Glossa. Small models make more
mistakes than Claude or a bigger model on your own server, so treat their explanations as hints.

**One server for a household or classroom.** Run Ollama or LibreTranslate on one computer and point
everyone's Glossa at it; nothing leaves your network, and there is nothing to build.

- *Ollama:* start it with the environment variable `OLLAMA_HOST=0.0.0.0` so other devices can reach it. In
  each person's Glossa, choose **Ollama, LM Studio or another server** and enter
  `http://<that computer's address>:11434`.
- *LibreTranslate:* `docker run -p 5000:5000 libretranslate/libretranslate`, then pick LibreTranslate and
  enter `http://<that computer's address>:5000`.

Each browser asks for permission to reach that address when you save. Traffic inside a home network is
plain HTTP, so don't expose these ports to the internet.

## Other sites

Glossa doesn't run on other sites until you ask it to, so it needs no access to them at install time.

1. Open the page with the video and click Glossa's toolbar button.
2. Choose **Subtitles for the video on this page**. Glossa follows the largest video that's playing.
3. If the video has no subtitles of its own, click the file button in Glossa's toolbar (hover over the video)
   and pick a `.srt` or `.vtt` file. Glossa guesses the language from the file name (`movie.es.srt`) or
   the text; correct it in the toolbar if needed.

Tick **Always on <site>** in the popup to start Glossa there by itself; the browser asks for access to that
site. Remove sites under **Other sites** on the settings page.

Limits: subtitles a site draws itself (rather than as `<track>` elements) aren't read, so load a file
instead. Cross-site subtitle tracks only load if the site allows it. If a player puts the bare video
element into fullscreen, nothing can be drawn over it, so the browser shows the subtitles without clickable
words. Most players put their whole player into fullscreen, and Glossa works there. Netflix and other
services with protected video aren't supported yet.

## Privacy

Glossa has no server, collects no analytics, and never sees your data. Only these requests leave your
browser:

- **Wiktionary** (`en.wiktionary.org`): words you click, to look up definitions.
- **The translator you chose**: words and lines you look at. The built-in browser translator runs on your
  device and sends nothing.
- **The AI model you chose**, if any: the word or line you ask about, with the lines around it, or the
  word when you press "Look up with AI". The two on-device options send nothing.
- **Hugging Face**, once, if you download Glossa's on-device model.
- **YouTube**: Glossa reads the caption files the YouTube player already downloads.

On other sites Glossa only reads the subtitle tracks the page already loaded, or the file you pick. It
sends nothing to those sites.

API keys stay in your browser's extension storage on this device. They aren't synced, and only Glossa's
background script reads them. Glossa asks for permission to reach a server only when you save a setting
that uses it.

## Saved words and Anki

Saved words are on the settings page under **Saved words**:

- **Export CSV**: a spreadsheet with each word, its translation, definition, sentence, the sentence's
  translation, and a link to the video at that moment.
- **Export for Anki**: a text file. In Anki, choose **File → Import** and pick it. The fields, HTML and tags
  are set up automatically. Each card shows the word and its sentence on the front, and the translation,
  definition and translated sentence on the back.

## Development

```bash
pnpm dev            # Chrome with the extension and hot reload, opens YouTube
pnpm dev:firefox    # same, in Firefox
pnpm test           # unit tests (Vitest)
pnpm --filter @glossa/core eval qwen3:8b   # Japanese→English translation check against a local Ollama model
                                           # (EVAL_SUITE=es-en.json for Spanish→English)
pnpm typecheck
pnpm build
pnpm --filter @glossa/extension zip   # a .zip of the build
```

`pnpm dev` uses a fresh browser profile. To use a different browser binary or a profile of your own,
create `apps/extension/web-ext.config.ts`; it's ignored by git. See
[WXT's docs](https://wxt.dev/guide/essentials/config/browser-startup.html).

### Layout

```
packages/core        Platform-independent logic, no browser APIs
  src/subtitles      Parsing YouTube json3, WebVTT and SRT; finding the active cue
  src/text           Word segmentation (Intl.Segmenter), language names, guessing a file's language from its name
  src/providers      Translators, Wiktionary, AI models (Claude, OpenAI-compatible, the browser's built-in model), prompts
  src/vocab.ts       CSV and Anki export
apps/extension       Browser extension (WXT + Preact, Manifest V3)
  entrypoints/youtube-hook.content.ts   Runs in YouTube's page; sees caption requests, drives the player API
  entrypoints/youtube.content/          YouTube's controller: loads captions, sizes the overlay to the player
  entrypoints/video.content/            Any page's HTML5 video: <track>s or a subtitle file. Started from the popup
  components/overlay/                   The overlay shared by both: subtitles, toolbar, word card, base controller
  entrypoints/background.ts             Provider calls, cache, API keys
  entrypoints/offscreen, llm-worker.ts  Glossa's on-device model: a hidden page running WebLLM in a worker
  entrypoints/popup, options            Toolbar popup and settings page
  lib/                                  Settings, messaging, vocabulary storage, the on-device model list, video sites
  scripts/fetch-model-libs.mjs          Downloads the on-device models' GPU code (pinned, checked by SHA-256)
```

**How it reads YouTube captions.** YouTube signs its caption requests, so Glossa doesn't request captions
itself. A small script in the page watches the requests the player makes. It asks the player (through its
own API) to load the track you picked. Then it reuses that signed URL to download the track as json3, and
YouTube's machine translation of it with `&tlang=<your language>`. YouTube's own caption window is
hidden while Glossa is on.

`packages/core` doesn't depend on the extension, so a web player can reuse it later.

## Roadmap

Open work is tracked in [GitHub Issues](https://github.com/amngy/glossa/issues): more sites,
a web player, mobile, learning tools, local speech recognition for videos without subtitles, reading aids
(furigana, pinyin) and better local models. Every feature keeps a local-first path; remote servers are
opt-in. Glossa won't be published to the extension stores.

Ideas and help are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Glossa is free software, licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
If you run a modified version as a service for others, you must share its source.

Dictionary definitions come from [Wiktionary](https://en.wiktionary.org) under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each word card names and links its source.
