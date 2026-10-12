# Glossa privacy policy

Last updated: 2026-10-12

Glossa is a free, open-source browser extension. It has no server, no accounts, no analytics and no
tracking. The developer never receives any data from your use of it.

## What stays on your device
- Your settings, saved words and cached translations, in the browser's extension storage.
- Your API keys (DeepL, AI models), in extension storage on this device. They are not synced, and only
  Glossa's background script reads them.
- The on-device translation or AI model, if you download one.

## What leaves your device, and when
Only requests you caused, to services you chose:

- **Wiktionary** (`en.wiktionary.org`): the word you click, to look up definitions.
- **The translator you chose** (for example DeepL or a LibreTranslate server): the words and lines you look
  at. The built-in browser translator runs on your device and sends nothing.
- **The AI model you chose**, if any (a server you run, or a hosted one with your key): the word or line you
  ask about, with the lines around it. The on-device options send nothing.
- **Hugging Face**, once, if you download Glossa's on-device model.

Glossa asks for permission to reach a server only when you save a setting that uses it. Those services
have their own privacy policies; Glossa cannot see or control what they do with a request.

The exact, current list is the [Privacy section of the README](README.md#privacy).

## Pages Glossa reads
On YouTube Glossa reads the caption files the player already downloads. On other sites it reads only the
subtitle tracks the page already loaded, or a file you pick. It sends nothing to those sites and does not
read anything else on the page.

## Firefox's data consent prompt
Firefox lists "website content" when you install Glossa. That is the words and lines above, sent to
Wiktionary and to the translator or AI model you choose. Nothing is sent to the developer.

## Changes and contact
Changes to this policy are made in this repository and visible in its history. Questions or concerns:
[open an issue](https://github.com/amngy/glossa/issues).
