# Word Forge: rules for agents

A Travel Schooling class (game slug `wordforge`, hostname `wordforge.travelschooling.com`).
It conforms to the class standard in `travelschooling-portal/docs/class-standard.md`. Work
orders and review logs live under `docs/plans/`.

Rules:
- The game in `public/index.html` is one classic script served as-is; the Next.js shell
  (`src/`) only adds the login gate, the headers and the deploy path. Do not bundle,
  transpile or split the game.
- `src/proxy.ts`, `src/lib/session.ts` and `src/lib/session-cookie.ts` are byte-identical
  to Factors' (the canonical copies); change them there first, then copy.
- Kit hooks live only in `public/kit.js`, the module bootstrap in `index.html`, the
  three `window.__wfAward?.(...)` calls and the Return to Home Room button's
  `window.__wfFlushAwards` wait. Award only events present in the portal seed's
  `xp_events` for `wordforge` (`word_forged`, `story_unlocked`).
- `public/progress-store.js` (saved-progress writer) and `public/leave-guard.js` (Return to
  Home Room guard) are plain helper scripts like `sw-policy.js`, each loaded with its own
  `<script>` tag and unit-tested; they are not a build step.
- Page scripts (`kit.js`, `progress-store.js`, `leave-guard.js`) are loaded as `?v=<N>`
  where N is the worker's `CACHE` version, and precached in `SHELL` under exactly that URL.
  Changing one means bumping `CACHE` and every `?v=` together; `tests/sw-policy.test.mjs`
  enforces it, so an older worker can never pair the new page with its cached old script.
- The worker caches a page only when `sw-policy.js` says so (200, not redirected, same
  origin); never cache the portal's login page.
- `NEXT_PUBLIC_TS_KIT` is never set on Vercel; `NEXT_PUBLIC_SUPABASE_URL` must be.
- The repository is public: CI inlines the shared `class-verify` steps instead of calling
  the portal's workflow.
- The `gh-pages` branch is a redirect stub only; its cleanup logic is
  `tools/pages-stub/cleanup.js` and must stay scoped to Word Forge.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
