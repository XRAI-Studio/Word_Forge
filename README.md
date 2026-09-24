# Word Forge

An educational browser game that teaches kids to read English by its Latin building blocks:
**prefix + stem + suffix**. A Travel Schooling class: game slug `wordforge`, hostname
`https://wordforge.travelschooling.com` (sign in at the portal first).

The game is one file, `public/index.html` (markup, styles and logic), plus its installable
and offline layer (`manifest.webmanifest`, `sw.js`, `sw-policy.js`, `icons/`, `fonts/`). A
minimal Next.js shell around it provides what the class standard requires
(`travelschooling-portal/docs/class-standard.md`): the page-level login gate
(`src/proxy.ts`), the security headers (`next.config.ts`), and one deploy path.

## Play

Open `https://wordforge.travelschooling.com` signed in to the school portal. It was
previously published on GitHub Pages; that address now redirects here and releases
installed copies from their old service worker.

## Install it

Word Forge is a Progressive Web App, so it can be installed like a normal app:

- **iPhone / iPad**: open it in Safari, then Share → *Add to Home Screen*
- **Android / Chromebook**: Chrome offers *Install* in the address bar or ⋮ menu
- **Desktop**: Chrome and Edge show an install icon in the address bar

Installed, it launches full-screen with no browser chrome, and **works with no internet
connection**: everything, fonts included, is served from the device. Offline, the last
cached copy of the game opens without the portal gate (nothing leaves the device, and XP
cannot be awarded offline); the worker only ever caches a real 200 copy of the page, never
the portal's login page.

## Modes
- **🔨 Forge**: build a word from color-coded snap-blocks to match a definition
- **🔍 Decode**: pick the meaning of a highlighted word part
- **📚 Lexicon**: searchable reference of all 182 parts, with tappable prefix "family story" journeys
- **⚡ Flashcards**: flip-cards for prefixes, stems, suffixes, or all 500 words
- **📖 Stories**: word-history stories unlock every 3 correct answers

## Content
- 25 prefixes, 25 suffixes, 132 stems
- 500 real English words, each validated against WordNet with real definitions
- 49 "Aha!" etymology facts + 18 unlockable history stories

## Progress and XP

Unlocked stories are saved on the device and survive closing the game. Score and streak
are per-round and reset each time you start a mode, which is intended. Progress is stored
per browser, so it does not follow a child between devices.

XP goes through the portal kit (`public/kit.js`; all awards are fire-and-forget and the
portal caps them per event and per day):

| Event | When |
|---|---|
| `word_forged` | a correct forge, or a correct decode answer (a decode counts as a forged word; the seed has no separate event) |
| `story_unlocked` | a story unlocks (every third correct answer) |

## Run it locally

```
npm install
npx playwright install chromium   # once, for npm run e2e
npm run dev                       # http://localhost:3000, mock kit, no portal session needed
npm run verify                    # typecheck, lint, Node tests, vitest
npm run e2e                       # production-mode gate check + development-mode game run
npm run build
```

On `localhost` the page gate lets everything through and `public/kit.js` returns a mock kit
that records awards on `window.__kitAwards`; the e2e reads them.

## Deploy

- **A push to `main` deploys production.** There is no staging; `*.vercel.app` preview
  URLs sit behind Vercel's deployment protection and cannot sign a learner in.
- **Vercel project `wordforge`** (team `scottmacscott-8212s-projects`): Root Directory `.`,
  Production Branch `main`; `vercel.json` sets `framework: nextjs`.
- **Environment:** `NEXT_PUBLIC_SUPABASE_URL` is required (the page gate verifies the
  portal session against its JWKS; without it the site answers 500 rather than looping to
  the login). `NEXT_PUBLIC_TS_KIT` is never set on Vercel.
- **DNS:** one record in Hostinger's DNS Zone Editor, `A wordforge 76.76.21.21`, already in
  place. Never create the subdomain through hPanel's Websites screen and never enable
  Hostinger CDN. `npm run dns:check` in the portal repo verifies all seven hosts.
- **CI:** `.github/workflows/verify.yml` runs the same steps as the shared `class-verify`
  workflow on every push and pull request, inlined: this repository is public and the
  portal is private, and GitHub does not let a public repository call a private
  repository's reusable workflow. Keep the steps in step with `class-verify.yml`.
- **GitHub Pages:** the `gh-pages` branch holds only a redirect stub (and a worker that
  unregisters itself); the Pages source points at it. `tools/pages-stub/cleanup.js` is the
  tested selection logic the stub inlines: it touches only Word Forge's own registration
  and caches on the shared `xrai-studio.github.io` origin.

## Files
- `public/index.html`: the complete game
- `public/manifest.webmanifest`, `public/sw.js`, `public/sw-policy.js`, `public/icons/`,
  `public/fonts/`: the installable/offline layer
- `public/kit.js`: the portal kit wrapper (mock on localhost)
- `word-forge-500-words.md`: full word list with breakdowns (not served)
- `Interesting Word Etymology Stories for Educational Games.md`: source research for the
  story content (not served)
- `macscott.json`: manifest that publishes the game to the MacScott showcase

## Notes for maintainers

The service worker fetches the page **network-first**, so a new deploy reaches installed
users on their next online load. Fonts and icons are cache-first. If you rename or add a
shell file, add it to `SHELL` in `sw.js` and bump `CACHE`.
