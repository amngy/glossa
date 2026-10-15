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
  as an Anki deck, along with the sentence they appeared in. Mark words you already know with the check on
  the word card: they're never highlighted. In Settings you can also underline every word you haven't
  saved or marked, so the new ones stand out.
- **Furigana (optional).** Japanese lines can show the reading over each kanji. It needs the "Japanese
  readings" pack, which you install from Settings; see [Optional packs](#optional-packs). Chrome and Edge only
  for now.
- **Subtitles from sound (optional).** For a video with no subtitles at all, Glossa can listen to the tab's
  audio and write them on your device, with a Whisper speech pack or Chrome's built-in recognition. Lines
  show up a few seconds after they're spoken, so rewind to read one. On YouTube, an experimental mode
  transcribes ahead from the audio the player has already loaded. Chrome and Edge; see
  [Subtitles from sound](#subtitles-from-sound).
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

## Desktop companion (optional, Windows)

A small program that recognises speech on your own graphics card, for features that turn audio into
subtitles (see [Subtitles from sound](#subtitles-from-sound)): "transcribe ahead" on YouTube uses `large-v3`,
and live tab audio on any site uses Nemotron 3.5 streaming, which shows each line word by word while it's
spoken. It needs an NVIDIA GPU (about 4 GB of video memory for `large-v3` and 1 GB more for Nemotron once live
mode is used; without one it falls back to the CPU), a recent NVIDIA driver (Nemotron's runtime is built for
CUDA 13), [uv](https://docs.astral.sh/uv/) and Chrome, Edge or Brave.

1. In `apps/companion`, run `powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Download`.
   It registers the companion for your user (no admin rights) and, with `-Download`, fetches the Python
   packages and CUDA libraries (about 1-2 GB, PyPI), the `large-v3` model (about 3 GB, Hugging Face),
   NVIDIA's NeMo-Speech.cpp runtime (about 100 MB, GitHub) and the Nemotron 3.5 streaming model (about
   740 MB, Hugging Face) into `apps/companion/nemotron`. Both Nemotron files are pinned and checked by SHA-256.
2. Restart the browser and reload Glossa. The extension ID is fixed by the `key` in `wxt.config.ts`.
3. In Settings → Optional packs, turn on **Use the desktop companion for speech recognition**. The
   browser asks for the "nativeMessaging" permission, and the switch shows whether the companion answers
   and which models it runs (the first answer takes a few seconds while it loads the model).

The companion only runs while the browser has it open, has no window, and reads audio only from Glossa
over the browser's native messaging. After step 1 it never goes online.

## Other sites

Glossa doesn't run on other sites until you ask it to, so it needs no access to them at install time.

1. Open the page with the video and click Glossa's toolbar button.
2. Choose **Subtitles for the video on this page**. Glossa follows the largest video that's playing.
3. If the video has no subtitles of its own, click the file button in Glossa's toolbar (hover over the video)
   and pick a `.srt` or `.vtt` file. Glossa guesses the language from the file name (`movie.es.srt`) or
   the text; correct it in the toolbar if needed.

Tick **Always on <site>** in the popup to start Glossa there by itself; the browser asks for access to that
site. Remove sites under **Other sites** on the settings page.

**Stremio Web** (`web.stremio.com`) draws subtitles from files it downloads itself. Glossa reads those files
and lists each one in its toolbar by language. The subtitle you pick in Stremio becomes Glossa's; one in your
own language becomes the line translation, and Stremio's own subtitles are hidden while Glossa shows its
own. Tick **Always on web.stremio.com** in the popup: started from the button instead, Glossa only sees the
subtitles Stremio downloads after that, so pick the subtitle again in Stremio, and it has to guess their
language from the text. The Stremio desktop app can't load extensions.

**Crunchyroll** (`www.crunchyroll.com`) has no subtitles in the spoken language (no Japanese subtitles for
Japanese audio), so the study line comes from the sound: transcribe the audio (Alt+T). Glossa downloads
Crunchyroll's official subtitles in your own language and uses them as the line translation. Tick
**Always on www.crunchyroll.com** in the popup, so Glossa sees the episode's subtitle list as it loads, and
turn Crunchyroll's own subtitles off: with them on, it plays a video with the text burned into the picture.

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
- **Hugging Face**, once, if you download Glossa's on-device model, and once per speech pack you install.
  Hugging Face sees the download only; the audio never leaves your device.
- **Google**, once per language, if you turn on Chrome's built-in speech recognition in Settings and press the
  download button: a speech pack of about 60 MB. Google sees the download only. Recognition then runs on your
  device, and Glossa never uses Chrome's cloud recognizer: if the pack is missing or the browser can't keep
  recognition on the device, it stops instead. Only Google Chrome gets these packs: Brave, Chromium and Chrome for
  Testing offer the download but never finish it, so Glossa gives up after five minutes.
- **jsDelivr** (`cdn.jsdelivr.net`), once per pack, when you press Install on an [optional pack](#optional-packs).
  Nothing is requested from it otherwise.
- **Desktop companion** (optional): the audio goes to a program on your computer, never over the
  network. Only the one-time installs reach out: PyPI (Python packages, CUDA libraries), Hugging Face
  (models) and GitHub (NVIDIA's NeMo-Speech.cpp release).
- **YouTube**: Glossa reads the caption files the YouTube player already downloads, and, with
  "transcribe ahead" on, the audio it already downloaded. Neither is a new request.

On other sites Glossa only reads the subtitle tracks the page already loaded, or the file you pick. It
sends nothing to those sites. On Stremio Web it reads the subtitle files and list Stremio already downloaded;
that's no new request either. On Crunchyroll it downloads one subtitle file per episode (two if there's
one in the spoken language) from Crunchyroll's own servers, the site you're watching.

API keys stay in your browser's extension storage on this device. They aren't synced, and only Glossa's
background script reads them. Glossa asks for permission to reach a server only when you save a setting
that uses it.

## Optional packs

Some features need data Glossa doesn't ship. Settings → **Optional packs** lists them with their size and
where they come from. Nothing is downloaded until you press Install. Each file is checked against a
checksum pinned in Glossa, stored in the extension's own storage, and used offline from then on. Remove a
pack in the same place to free the space. Packs are data only; the extension never runs downloaded code.

| Pack | Size | From | Used for |
| --- | --- | --- | --- |
| Japanese readings | 17 MB | jsDelivr (npm `@sglkc/kuromoji`, IPAdic) | Furigana over kanji |
| Speech recognition (tiny) | 44 MB | Hugging Face (`onnx-community/whisper-tiny`) | Subtitles from sound |
| Speech recognition (base) | 80 MB | Hugging Face (`onnx-community/whisper-base`) | Subtitles from sound, more accurate |

## Subtitles from sound

For videos with no subtitles at all. Install a speech pack in Settings → Optional packs, open the video,
click Glossa's toolbar button, pick the language being spoken and press **Transcribe this video's audio**.
Glossa asks once for permission to listen to tab audio. The video keeps playing as usual.

- **On your device.** The tab's audio goes to Whisper running as WebAssembly on your CPU. Nothing is sent
  anywhere, and the audio isn't saved. Only the lines of text are kept, for as long as the page is open.
- **Or Chrome's built-in recognition (Google Chrome only).** Instead of a Whisper pack, turn on "Use
  Chrome's built-in speech recognition" in Settings → Optional packs and download its language pack (about
  60 MB, from Google, once per language). It runs on your device, the engine behind Chrome's Live Caption;
  Glossa never uses Chrome's cloud recognizer. Brave and Chromium offer the download but never finish it.
  No Arabic.
- **A few seconds behind.** Glossa cuts the audio at pauses and recognises each piece, so a line shows up
  after it was spoken. Use the previous-line key (<kbd>A</kbd>) or rewind to read it. Rewatching a part
  doesn't add its lines twice.
- **Accuracy.** Small models make mistakes. Eight short Japanese sentences played through a tab: the base
  model got three exactly right and tiny one or two; the rest sounded right but had the wrong kanji or
  words. Expect more from clear speech without music. Whisper can also invent text for music or noise.
- **Speed.** About 5× faster than real time with the base model and 9× with tiny on one desktop CPU
  thread, so it keeps up with a video. On a slow computer it falls behind and skips what it can't process.
- **Ahead of time on YouTube (experimental).** Turn on "transcribe ahead" in Settings → Optional packs.
  Glossa then reads the audio YouTube's player has already downloaded, usually seconds to half a minute
  before it plays, so lines can be ready before they're spoken. No tab capture and no extra download:
  Glossa reads bytes the player already has. It switches YouTube's AI-dubbed audio back to the original
  track and skips ads. It reads Opus audio only for now; if your browser gets AAC audio from YouTube
  (possible in branded Chrome or Edge), no lines appear. With the [desktop companion](#desktop-companion-optional-windows)
  turned on, this audio is recognised by `large-v3` on your GPU instead, which is more accurate, and no
  speech pack is needed. If the companion doesn't answer, Glossa says so and uses the speech pack.
- **Live with the desktop companion.** With the companion on, tab audio streams to Nemotron 3.5 on your
  GPU: words show up grey about a second after they're spoken and settle about half a second after the
  sentence ends (eight Japanese sentences played through a tab: five to seven exactly right). Lines land on
  the video's timeline up to a second late. If the companion doesn't answer or has no Nemotron, Glossa says
  so and uses the speech pack.
- **Chrome and Edge only** for now. Firefox has no tab audio capture for extensions.
- Pages with protected video (DRM) may give silence. That isn't verified here.

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
  src/text           Word segmentation (Intl.Segmenter), language names, guessing a file's language from its name or add-on code
  src/providers      Translators, Wiktionary, AI models (Claude, OpenAI-compatible, the browser's built-in model), prompts
  src/asr            Speech: cutting audio at pauses, WebM demuxing, live lines, the companion protocol
  src/vocab.ts       CSV and Anki export
apps/companion       Desktop companion: GPU speech recognition over native messaging (Python, Windows installer)
apps/extension       Browser extension (WXT + Preact, Manifest V3)
  entrypoints/youtube-hook.content.ts   Runs in YouTube's page; sees caption requests, drives the player API
  entrypoints/youtube.content/          YouTube's controller: loads captions, sizes the overlay to the player
  entrypoints/video.content/            Any page's HTML5 video: <track>s or a subtitle file. Started from the popup
  entrypoints/stremio-hook.content.ts   Runs in Stremio Web's page; copies the subtitle files its player downloads
  entrypoints/crunchyroll-hook.content.ts  Runs in Crunchyroll's page; reads each episode's subtitle list
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
a web player, mobile, learning tools, reading aids (pinyin, romaji), faster speech recognition (GPU,
larger models; the plan is [#43](https://github.com/amngy/glossa/issues/43)) and better local models. Every feature keeps a local-first path; remote servers are
opt-in. Glossa won't be published to the extension stores.

Ideas and help are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Glossa is free software, licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
If you run a modified version as a service for others, you must share its source.

Dictionary definitions come from [Wiktionary](https://en.wiktionary.org) under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each word card names and links its source.
