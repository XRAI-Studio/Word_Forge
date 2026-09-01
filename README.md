# Word Forge

An educational browser game that teaches kids to read English by its Latin building blocks — **prefix + stem + suffix**.

## Play

**[Play it here](https://xrai-studio.github.io/Word_Forge/)**

Or open `index.html` in any browser — no install, no build, no dependencies.

## Install it

Word Forge is a Progressive Web App, so it can be installed like a normal app:

- **iPhone / iPad** — open it in Safari, then Share → *Add to Home Screen*
- **Android / Chromebook** — Chrome offers *Install* in the address bar or ⋮ menu
- **Desktop** — Chrome and Edge show an install icon in the address bar

Installed, it launches full-screen with no browser chrome, and **works with no
internet connection** — everything, fonts included, is served from the device.

## Modes
- **🔨 Forge** — build a word from color-coded snap-blocks to match a definition
- **🔍 Decode** — pick the meaning of a highlighted word part
- **📚 Lexicon** — searchable reference of all 182 parts, with tappable prefix "family story" journeys
- **⚡ Flashcards** — flip-cards for prefixes, stems, suffixes, or all 500 words
- **📖 Stories** — word-history stories unlock every 3 correct answers

## Content
- 25 prefixes, 25 suffixes, 132 stems
- 500 real English words, each validated against WordNet with real definitions
- 49 "Aha!" etymology facts + 18 unlockable history stories

## Progress

Unlocked stories are saved on the device and survive closing the game. Score and
streak are per-round and reset each time you start a mode, which is intended.

Progress is stored per browser, so it does not follow a child between devices.
Clearing site data clears it.

## Files
- `index.html` — the complete game (single file: markup, styles and logic)
- `manifest.webmanifest`, `sw.js`, `icons/`, `fonts/` — the installable/offline layer
- `word-forge-500-words.md` — full word list with breakdowns
- `Interesting Word Etymology Stories for Educational Games.md` — source research for the story content
- `macscott.json` — manifest that publishes the game to the MacScott showcase

## Notes for maintainers

The service worker fetches the page **network-first**, so a new deploy reaches
installed users on their next online load. Fonts and icons are cache-first. If
you rename or add a shell file, add it to `SHELL` in `sw.js` and bump `CACHE`.
