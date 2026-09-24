# Class standard, Phase 4 (Word Forge) — review log

Work order: `docs/plans/2026-09-23-class-standard-phase4.md`, on `main` (`ea380c8`).
Roles: host and coordinator Claude Code (Fable 5.1); plan reviewer Codex (CLI default
`gpt-6-astra` / `high`); builder Claude; inspector a fresh Codex session. Limits: MAX_ROUNDS 5,
MAX_FIX_ROUNDS 2, MAX_INSPECTION_ROUNDS 2, inspect on. Authorization: the user's 2026-09-23
approval of the seven-host plan and the instruction "continue"; commits to `main` (which
deploys once the Vercel project exists), the new Vercel project, its domain and
environment variable, and the GitHub Pages source switch are covered by Phase 4 of that plan.

## Review round 1 — Codex (REVISE)

Runner result: `scratchpad/claudex-runs/claudex-bhom_pqh/result.json` (a first attempt was
killed by the host machine for memory pressure before answering), session
`01a0d18b-a232-7091-8d82-116c718822a3`, plan SHA256
`0f68e62c872fb16e6eb480f8a247f7a18eecde9be6816b5b83f08f441dc616ec`, CLI `codex-cli 0.153.4`,
requested model: CLI default (`gpt-6-astra` / `high`). Usage: 806,247 input tokens
(696,704 cached), 5,157 output. Elapsed 227 s. Four medium findings, all accepted:
**WF-P4-001** the manifest link needs `crossorigin="use-credentials"` or Chromium's
credential-less manifest fetch is bounced by the gate; **WF-P4-002** the production e2e
must expect the manifest to be gated anonymously; **WF-P4-003** the Pages stub must clean
up only Word Forge's registration and caches on the shared github.io origin (selection
logic tested in `main`); **WF-P4-004** Katas' data-validator script does not apply to this
repository's `test` script. Dispositions `scratchpad/phase4-wordforge-feedback-r2.md`;
round 2 resumes the session.

## Review round 2 — Codex (APPROVED)

Runner result: `scratchpad/claudex-runs/claudex-p2mc2b37/result.json`, resumed session
`01a0d18b-a232-7091-8d82-116c718822a3`, plan SHA256
`1dd0db5f524b231872790716a15e5c88722e4b0f6758fa5c45b4ac8df8dda867`. Usage: 368,947 input
tokens (345,216 cached), 1,032 output. Elapsed 46 s. "The revised plan resolves WF-P4-001
through WF-P4-004. No additional material unresolved defects were identified." Rounds
used: 2 of 5. Pre-build commit: `ea380c8`. Builder Claude.

## Build (Claude, this session) — pre-build commit `ea380c8`

Layout: `git mv` of `index.html`, `sw.js`, `manifest.webmanifest`, `fonts/`, `icons/` into
`public/`; `.nojekyll` deleted; the two research documents stay at the root. Shell copied
from Katas (`src/`, the three vitest suites, `tsconfig.json`, `vitest.config.ts`,
`eslint.config.mjs`, `next.config.ts`, `vercel.json`, `.gitignore`; `package.json` with
Katas' versions, no `validate` script, `test` = Node tests + vitest; layout and not-found
titles changed to Word Forge). New: `public/kit.js` (Katas' minus the step tracker,
`GAME = 'wordforge'`), `public/sw-policy.js` + `public/sw.js` (cache `word-forge-v2`,
policy-gated page caching, `fetch` + `cache.put` precache, old cache deleted),
`tools/pages-stub/cleanup.js`, `tests/{kit,sw-policy,pages-stub}.test.mjs`,
`scripts/e2e.ts`, `.github/workflows/verify.yml` (inlined steps, public repository),
`README.md`, `AGENTS.md`, `macscott.json`. `public/index.html`: manifest link gains
`crossorigin="use-credentials"`; the kit script, a `#kit-banner` and a module bootstrap
(`initKit` → `window.__wfAward` with the account guard; redirecting / unavailable banners,
"Try again" reload) precede the game script; three award hooks (`checkForge`,
`answerDecode`, `maybeUnlockStory`). Vercel: project `wordforge` created and linked
(`prj_V4gfIl5P2SHM3ZInNxysdEvgIqmR`), GitHub connected, domain
`wordforge.travelschooling.com` assigned, `NEXT_PUBLIC_SUPABASE_URL` set for Production,
Framework Preset detected as Next.js, all before the push.

Two things found by the e2e and fixed before commit: the game's stylesheet has no global
`.hidden` rule, so the kit banner toggles its own inline `display`; and the game's
`current`/`forgePicks` are top-level `let` bindings (global lexical scope, not `window`
properties), so the e2e reads them as bare identifiers.

Proofs: `npm run verify` → typecheck and lint clean, 15 Node tests, 24 vitest tests;
`npm run build` clean with `ƒ Proxy (Middleware)`; `npm run e2e` PASS (production mode:
`/`, `/README.md?x=1`, `/manifest.webmanifest` → 307 with the local origin encoded, assets
200 with headers; development mode: boot with the mock kit, manifest link credentials,
`story_unlocked` once after three correct answers, `word_forged` for the current word,
repository files 404, game files 200).

### CI, live and Pages evidence after commit `5dcf74c` (2026-09-24)

- CI: `verify` (inlined steps) run 35954417557 **success** (criterion 6).
- Live, 10 s after the push, without a cookie: `/` → 307 to
  `https://class.travelschooling.com/login?next=https%3A%2F%2Fwordforge.travelschooling.com%2F`
  with the four headers and Vercel's HSTS (the certificate was already issued: the DNS
  record predated the project); `/sw.js`, `/kit.js`, `/sw-policy.js`, `/fonts/nunito.woff2`,
  `/icons/icon-192.png` → 200; `/manifest.webmanifest`, `/README.md`,
  `/word-forge-500-words.md` → 307 to the login with the path in `next=` (criterion 2,
  anonymous half).
- GitHub Pages: orphan branch `gh-pages` (`2534045`: `index.html`, `sw.js`, `.nojekyll`)
  pushed; Pages source switched to `gh-pages` / `/` through the API. The switch alone
  built nothing (the latest build was still `main`'s, serving a Jekyll rendering of the
  new README), so a build was requested through the API; after it,
  `https://xrai-studio.github.io/Word_Forge/` answers the stub (title "Word Forge has
  moved", `location.replace` present, no game data) and `/Word_Forge/sw.js` answers 200
  (criterion 7). Recorded as a deviation from the plan's "switched through the API"
  wording: the switch plus one explicit build request.
- Portal follow-up (`travelschooling-portal` `f6bf0c6`): the `wordforge` row lost its
  `pending` flag in `scripts/check-dns.mjs` (live `npm run dns:check` still ok), the
  guard's tests updated, and `docs/class-standard.md` marks Word Forge on the standard.
- Signed-in live checks (criterion 10, and the manifest request with credentials in a
  fresh signed-in context): **awaiting user verification**; the host's browser has no
  portal session and the host does not enter credentials.

## Inspection 1 — Codex (REVISE)

Runner result: `scratchpad/claudex-runs/claudex-atva1we1/result.json`, fresh session
`01a0d1a1-96c1-7581-8121-3464040c35c5`, base `ea380c8`, inspected tree = `abaecff`, CLI
`codex-cli 0.153.4`, requested model: CLI default (`gpt-6-astra` / `high`). Usage:
2,257,203 input tokens (2,024,448 cached), 6,290 output. Elapsed 241 s. One finding,
accepted (fix round 1 of 2):

- **WF-P4-INS-001 (medium)** `warm()` classified the *response's* URL rather than the
  requested one, so a precache fetch for `./index.html` that the gate redirected to the
  portal login (a 200 at `/login?next=…`) would be treated as an asset and stored under
  `./index.html`. *Fixed:* every shell entry, page or asset, is stored only when
  `WF_POLICY.cacheablePage` accepts the response (200, not redirected, same origin).
  Tests: the redirected login response is refused, and a source-level guard asserts
  `warm()` decides only through the policy (no `response.ok`, no `response.url`).

Fix round 1 proofs: `npm run verify` → typecheck and lint clean, 17 Node tests (was 15),
24 vitest tests; `npm run e2e` PASS (both parts). Sent for inspection 2 (the last of the
two authorized).
