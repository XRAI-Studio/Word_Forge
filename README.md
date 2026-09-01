# Word Forge

An educational browser game that teaches kids to read English by its Latin building blocks — **prefix + stem + suffix**.

## Play

**[Play it here](https://xrai-studio.github.io/Word_Forge/)**

Or open `index.html` in any browser — no install, no build, no dependencies.

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

## Files
- `index.html` — the complete game (single file: markup, styles and logic)
- `word-forge-500-words.md` — full word list with breakdowns
- `Interesting Word Etymology Stories for Educational Games.md` — source research for the story content
- `macscott.json` — manifest that publishes the game to the MacScott showcase

## Known limitations
- **Progress is not saved.** Score, streak and unlocked stories live in memory only, so
  reloading the page starts over.
- **Not fully offline.** Everything is inline except the Google Fonts stylesheet; without a
  connection the game still runs but falls back to system fonts.
