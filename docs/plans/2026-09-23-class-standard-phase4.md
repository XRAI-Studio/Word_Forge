# Class standard, Phase 4 (Word Forge): Next.js shell, page gate, kit awards, Pages redirect

Part of the seven-host rollout approved 2026-09-23 (master plan:
`C:\Users\thetr\.claude\plans\lets-take-a-step-vast-wall.md`; the standard:
`travelschooling-portal/docs/class-standard.md`; the Katas Phase 3 work order is the
direct precedent: a static game inside a Next.js shell, built and live on
karate.travelschooling.com). This work order covers only the `Word_Forge` repository, on
`main`. Game slug `wordforge`; hostname `wordforge.travelschooling.com` (DNS already
`A 76.76.21.21`); Vercel project `wordforge` (to create). Log:
`docs/plans/2026-09-23-class-standard-phase4-log.md`. The repository is public, so its CI
inlines the shared steps (standard rule 4.2 exception).

## Goal

Move Word Forge from GitHub Pages to the class standard without touching the game beyond
the award hooks: a Next.js shell serving the single-file PWA from `public/` at the site
root, the page-level login gate, the security headers, the kit with the two seeded awards
(`word_forged`, `story_unlocked`), one deploy path, and a redirect from the old GitHub
Pages origin that also releases installed copies from their old service worker.

## Acceptance criteria (observable)

1. Layout: `public/` holds `index.html`, `sw.js`, `sw-policy.js` (new), `kit.js` (new),
   `manifest.webmanifest`, `fonts/`, `icons/`, moved with `git mv`; `.nojekyll` deleted; the
   two research `.md` files stay at the repository root and are not served. The shell is
   Katas' layout exactly: `src/app/layout.tsx`, `src/app/not-found.tsx`, `src/proxy.ts`,
   `src/lib/session.ts`, `src/lib/session-cookie.ts` and `tests/{proxy,session,next-config}.test.ts`
   byte-identical to Katas' (which are Factors'); `next.config.ts` (four headers on
   `/(.*)`, rewrite `/` → `/index.html`); `vercel.json` `{ "framework": "nextjs" }`;
   `package.json` name `wordforge` with Katas' dependency versions and shell scripts
   (`dev`, `build`, `start`, `lint`, `typecheck`, `verify`, `e2e`), **except** Katas'
   `validate` script and the `npm run validate &&` prefix of its `test` script, which
   belong to the kata data and do not apply (WF-P4-004); here
   `"test": "node --test tests/*.test.mjs && vitest run"`. ESLint ignores `public/**`,
   `tests/**/*.mjs`, `tools/**`.
2. Live, without a cookie: `/`, `/index.html`, `/manifest.webmanifest` and any other
   non-asset path answer the gate's 307 to
   `https://class.travelschooling.com/login?next=<url>` with the four headers
   (`.webmanifest` is not on the canonical matcher's asset list and the copy stays
   byte-identical; an anonymous visitor cannot install the app, which is acceptable);
   `/sw.js`, `/kit.js`, `/fonts/nunito.woff2`, `/icons/icon-192.png` answer 200 (`.js`,
   `.woff2`, `.png` are asset extensions). Signed in: `/` serves the game (title
   `Word Forge — Latin Roots`), `/manifest.webmanifest` answers 200 when fetched with
   the session cookie, `/README.md` and `/word-forge-500-words.md` answer 404.
   **Manifest credentials (WF-P4-001):** Chromium fetches a web app manifest with
   credentials mode `omit` unless the link carries `crossorigin="use-credentials"`, so
   `public/index.html`'s `<link rel="manifest">` gains that attribute; without it even a
   signed-in learner's first visit (no controlling worker yet) would have the manifest
   request bounced by the gate and installation would fail. The development-mode e2e
   asserts the attribute is present; the live check is a fresh signed-in browser context
   (before any service worker controls the page) showing the manifest request as 200 in
   DevTools Network, performed by the user with the other signed-in checks.
3. Kit (rule 3): `public/kit.js` is Katas' `kit.js` with `GAME = 'wordforge'` and without
   `furthestStepTracker` (not needed). `public/index.html` loads the portal kit script and
   then a small `<script type="module">` that awaits `initKit()`: on `ready` it installs
   `window.__wfAward(event, detail)` (the account-guarded `award`, reloading through the
   gate on a mismatch, also checked on `visibilitychange`/`focus`); on `redirecting` it
   shows "Sending you to sign in…" in a new `#kit-banner`; on `unavailable` it shows
   "Could not reach the school portal" with a "Try again" button (`data-testid="retry-kit"`)
   that reloads (rule 3.4). The game script (classic, unchanged in structure) calls
   `window.__wfAward?.(...)` at three points: `checkForge()` on a correct forge →
   `word_forged { word }`; `answerDecode()` on a correct answer → `word_forged { word }`
   (decision recorded in the master plan: a correct decode counts as a forged word; the
   seed has no separate event); `maybeUnlockStory()` when a story unlocks →
   `story_unlocked { story: <index> }`. Awards before the module has initialised are
   dropped (`__wfAward` undefined), which is the first second of the page only. Local
   progress (`wordforge:progress`) is untouched.
4. Service worker with a gated page: `public/sw.js` bumps `CACHE` to `word-forge-v2`, and
   its page handling goes through `public/sw-policy.js` (`importScripts`; it sets
   `self.WF_POLICY`) whose `cacheablePage(response)` returns true only for a `200`,
   non-redirected, same-origin response, so a session that expired between visits never
   stores the portal's login page as the offline copy of the game (`fetch` follows the
   gate's 307). Install precaches the shell with `fetch` + `cache.put` under the same
   rule instead of `cache.add`, and on activate deletes `word-forge-v1`. Offline, an
   already-cached page still opens without the server gate (no data leaves the device and
   the kit cannot award offline); recorded as an accepted property of an offline-capable
   class. `tests/sw-policy.test.mjs` covers the four cases (ok; redirected; other origin;
   non-200).
5. Tests: `tests/kit.test.mjs` (Katas' kit tests minus the tracker, `GAME` and mock
   checks), `tests/sw-policy.test.mjs`, the three vitest suites. `npm test` runs the Node
   tests and `vitest run`; `npm run verify` = typecheck, lint, test.
5b. `scripts/e2e.ts` (rule 4.1), Katas' two-part shape: (a) production mode (`next build`,
   `next start --hostname localhost`, `NODE_ENV=production`, dummy
   `NEXT_PUBLIC_SUPABASE_URL`, redirects disabled): `/`, `/README.md?x=1` **and
   `/manifest.webmanifest`** → 307 with the encoded local origin, path and query (the
   manifest is not an asset extension, so without a cookie it is gated like a page);
   `/sw.js`, `/kit.js`, `/fonts/nunito.woff2` → 200; the four headers on every response.
   The manifest's authenticated 200 is verified separately (criterion 2, signed in). (b) development mode
   (`next dev`, `NEXT_PUBLIC_TS_KIT=mock`): Playwright opens `/`, asserts the title, that
   `window.__wfAward` becomes defined, that the Forge stage rendered (`#stage` has a
   card), then drives the two award paths without depending on the random word: it calls
   the game's own `maybeUnlockStory()` three times and asserts exactly one
   `story_unlocked` award with `story: 1`, and calls `checkForge()` after filling
   `forgePicks` from `current.w` (the globals the classic script declares) and asserts one
   `word_forged` award whose `word` equals `current.w[0]`; asserts no page errors; and
   `/README.md`, `/word-forge-500-words.md` → 404 while `/index.html`, `/sw.js` → 200.
6. `.github/workflows/verify.yml` with the inlined steps (public repository), on push and
   pull request to `main`; the first run is green.
7. GitHub Pages redirect, **scoped to Word Forge** (WF-P4-003: `xrai-studio.github.io` is
   one origin shared by every project site, so the stub must not touch other apps'
   registrations or caches): a `gh-pages` branch holding only `index.html` and `sw.js`.
   The stub page's script unregisters only the service worker registration whose scope
   ends with `/Word_Forge/`, deletes only caches named `word-forge-v1` or `word-forge-v2`,
   then `location.replace("https://wordforge.travelschooling.com/")` (a meta refresh backs
   it up). The selection logic lives in `main` as `tools/pages-stub/cleanup.js`
   (`selectWordForgeCleanup({ registrations, cacheNames })` → `{ unregister, deleteCaches }`)
   with `tests/pages-stub.test.mjs` proving an unrelated same-origin registration
   (`/Other_App/`) and cache (`other-app-v3`) are left alone while Word Forge's are
   selected; the stub inlines that function verbatim (the branch has no build). The stub's
   `sw.js` unregisters itself on activate (`self.registration.unregister()`, then
   `clients.matchAll` → `navigate` each client to the new host); its registration scope is
   `/Word_Forge/`, so it too touches nothing else. The Pages source is switched to
   `gh-pages` / `/` through the API (`PUT /repos/XRAI-Studio/Word_Forge/pages` with
   `source`); afterwards `https://xrai-studio.github.io/Word_Forge/` answers the stub
   (HTML containing `wordforge.travelschooling.com`) and no game markup. Installed copies
   pick the stub up on their next online load because the old worker fetched the page
   network-first.
8. Vercel: project `wordforge` created and linked (`vercel link --yes --project wordforge`,
   `vercel git connect` to `XRAI-Studio/Word_Forge` on `main`), domain
   `wordforge.travelschooling.com` added (`vercel domains add`), `NEXT_PUBLIC_SUPABASE_URL`
   set for Production, all before the push; TLS issued (`vercel certs issue` if it stalls).
   Framework via `vercel.json`; Root Directory `.`; Production Branch `main`.
9. `README.md` rewritten per the standard (play/install text kept, the GitHub Pages link
   replaced by the hostname, the award mapping, local dev, "Deploy" section with the
   public-repository CI note, the Pages-redirect note); `AGENTS.md` new; `macscott.json`
   `liveUrl` → `https://wordforge.travelschooling.com`, `embeddable: false`.
10. Live, signed in as a learner (awaiting user verification if no session is available
    to the host at build time): the game loads at `/`, a correct forge produces
    `POST rpc/award` 200 for `word_forged`, the third correct answer produces
    `story_unlocked`; signed out, the curl redirect in criterion 2.

## Approach

Copy Katas' shell files verbatim (they are Factors' where they overlap), then the Word
Forge specifics: the module bootstrap in `index.html`, three one-line hook calls in the
classic script, `sw-policy.js` + the `sw.js` changes, `kit.js`. The Pages redirect is a
separate orphan branch (`git checkout --orphan gh-pages` in a temporary worktree) with two
files, pushed once. Vercel setup is done from the repository with the CLI before pushing
`main`, so the first push builds into the linked project.

## Non-goals
Any change to the word data, modes or visuals; kit `load/save` for the local progress
(stays on the device, as the README says); the research documents; disabling the old
Pages site (it now serves the redirect); Horizon.

## Confirmed assumptions
- `main` is `ea380c8`; the game is one classic `<script>` (function declarations become
  globals; `current`, `forgePicks`, `checkForge`, `maybeUnlockStory` are reachable from a
  module or from Playwright's `page.evaluate`).
- All paths in the game, the manifest (`id`, `start_url`, `scope` = `./`) and the worker
  are relative, so serving from the site root needs no path edits.
- Fonts, icons and scripts are on the canonical matcher's asset list; `.webmanifest` is
  not, and the copy stays byte-identical. The browser fetches `manifest.webmanifest` with
  credentials (same-origin), so the gate passes it for a signed-in learner and redirects
  it for an anonymous one; an anonymous visitor cannot install the app, which is
  acceptable (criterion 2 states both expectations).
- The Vercel GitHub app already has access to `XRAI-Studio` repositories (Factors, Word
  Power and KATAS are git-connected).
- The DNS record `wordforge A 76.76.21.21` exists (portal `npm run dns:check`, pending
  flag to be removed in the portal in the same day's follow-up commit).

## Risks
- If `vercel git connect` cannot find the GitHub repository, the fallback is connecting
  it in the Vercel dashboard (user), recorded as a deviation.
- The old service worker on github.io keeps the old page until the learner is online;
  nothing can be done about a device that never comes back online.

## Verification
- `npm run verify` → exit 0; `npm run build` clean with `ƒ Proxy (Middleware)`;
  `npm run e2e` → PASS (both parts).
- `gh run list --workflow=verify.yml -L1` → success.
- `curl -sI https://wordforge.travelschooling.com/` → 307 + four headers;
  `/sw.js` 200; `/README.md` 307.
- `curl -s https://xrai-studio.github.io/Word_Forge/` → the redirect stub.
- Chrome as a learner: the game loads, a correct forge awards `word_forged`.
