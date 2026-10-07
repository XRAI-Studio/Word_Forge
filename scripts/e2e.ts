/**
 * End-to-end checks for the Word Forge shell (class standard rule 4.1), in two parts:
 *
 *  (a) Shell and gate, production mode: `next build` + `next start` bound to localhost.
 *      Production mode disables the localhost bypass, so requests without a cookie must
 *      get the page gate's 307 (pages and the manifest), assets must answer 200, and every
 *      response must carry the four headers. This proves the proxy is registered by Next.
 *  (b) Game and awards, development mode: `next dev` on localhost with the mock kit.
 *      Playwright opens the game, waits for the kit bootstrap, and drives the two award
 *      paths through the game's own globals (the classic script declares them), checking
 *      the awards the mock recorded on window.__kitAwards, plus the 404s for repository
 *      files and the manifest link's credentials attribute. Then the Return to Home Room
 *      button: a half-built word opens the leave dialog (Escape and "Stay and save" keep
 *      the learner here); with the word cleared it goes to the portal (route intercepted)
 *      with no beforeunload prompt. The launcher-tile saves the mock recorded on
 *      window.__kitSaves are checked by headline text. A second page starts with a legacy
 *      unscoped progress record, holds the mock's first load open and leaves during it:
 *      the record is claimed by the learner, and the start-up's first save (existing
 *      progress, no play) still happens before the navigation (R001, R007).
 *      Cross-device sync (Plan 3, CDS3-007): two browser contexts ("pc", "phone") share one
 *      in-node versioned store through the window.__tsTestKit seam; the phone's answers
 *      reach the pc tab when it is shown again, an answer made while the pc's kit is
 *      offline is sent on the `online` event with no further answer, and the pc page
 *      reopened with its kit offline shows the total from its local synced state.
 *
 *   npm run e2e            (needs `npx playwright install chromium` once)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { chromium, type Page } from "playwright";
import { mergeSync, syncTotal } from "../public/kit.js";

const PORTAL_LOGIN = "https://class.travelschooling.com/login?next=";
const HOME_ROOM = "https://class.travelschooling.com/";
const HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function log(msg: string) {
  process.stdout.write(`[e2e] ${msg}\n`);
}

function expectEq<T>(actual: T, expected: T, what: string) {
  if (actual !== expected) throw new Error(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForServer(base: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(base, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`server at ${base} did not start`);
}

function startNext(args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn("npx", ["next", ...args], {
    env: { ...process.env, BROWSER: "none", ...env },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(String(d)));
  child.stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(String(d)));
  return child;
}

function listenersOnPort(port: number): number[] {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
      return [...new Set(out.split(/\r?\n/).filter((l) => l.includes(`:${port} `) && l.includes("LISTENING")).map((l) => Number(l.trim().split(/\s+/).pop())))].filter((n) => n > 0);
    }
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split(/\s+/).map(Number).filter((n) => n > 0);
  } catch {
    return [];
  }
}

function killPid(pid: number) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

function stopServer(child: ChildProcess, port: number) {
  if (child.pid) killPid(child.pid);
  for (const pid of listenersOnPort(port)) killPid(pid);
}

function checkHeaders(res: Response, what: string) {
  for (const [k, v] of Object.entries(HEADERS)) expectEq(res.headers.get(k), v, `${what} header ${k}`);
}

// ---------------------------------------------------------------- part (a)

async function gateInProductionMode() {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const env = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" } as const;
  log("building the shell (next build)");
  const stdio: "inherit" | "ignore" = process.env.E2E_VERBOSE ? "inherit" : "ignore";
  execFileSync("npx", ["next", "build"], { env: { ...process.env, ...env }, shell: true, stdio });
  const server = startNext(["start", "--hostname", "localhost", "--port", String(port)], env);
  try {
    await waitForServer(base, 60_000);
    const get = (p: string) => fetch(base + p, { redirect: "manual" });

    for (const p of ["/", "/README.md?x=1", "/manifest.webmanifest"]) {
      const res = await get(p);
      expectEq(res.status, 307, `GET ${p} without a cookie`);
      expectEq(res.headers.get("location"), PORTAL_LOGIN + encodeURIComponent(`${base}${p}`), `GET ${p} location`);
      checkHeaders(res, `GET ${p}`);
    }
    log("production: /, a repository path and the manifest redirect to the portal login with the local origin in next=");

    for (const asset of ["/sw.js", "/kit.js", "/sw-policy.js", "/progress-store.js", "/leave-guard.js", "/fonts/nunito.woff2", "/icons/icon-192.png"]) {
      const res = await get(asset);
      expectEq(res.status, 200, `GET ${asset}`);
      checkHeaders(res, `GET ${asset}`);
    }
    log("production: assets answer 200 with the security headers");
  } finally {
    stopServer(server, port);
  }
}

// ---------------------------------------------------------------- part (b)

type Award = { event: string; detail: Record<string, unknown> };
type SyncedState = { v: 2; correct: Record<string, number> };
type Save = { state: SyncedState; summary: { headline: string; percent: number } };
type Win = Window & {
  __kitAwards?: Award[];
  __kitSaves?: Save[];
  __wfAward?: unknown;
  checkForge?: () => void;
  maybeUnlockStory?: () => void;
  setMode?: (m: string) => void;
};
// Top-level `let` bindings of the game's classic script, visible to evaluated code by name.
declare const current: { w: string[] };
declare const forgePicks: { prefix: string | null; stem: string | null; suffix: string | null };
declare const WORDS: Array<Array<string | null>>;
declare const PRAISE: string[];

async function awards(page: Page): Promise<Award[]> {
  return page.evaluate(() => (window as unknown as Win).__kitAwards ?? []);
}

/** Waits until the mock kit's most recent save carries `headline`; returns that save. */
async function lastSaveIs(page: Page, headline: string): Promise<Save> {
  await page.waitForFunction(
    (h) => {
      const saves = (window as unknown as Win).__kitSaves ?? [];
      return saves.length > 0 && saves[saves.length - 1].summary.headline === h;
    },
    headline,
    { timeout: 30_000 },
  );
  return page.evaluate(() => {
    const saves = (window as unknown as Win).__kitSaves!;
    return saves[saves.length - 1];
  });
}

/**
 * A browser that still holds the old unscoped `wordforge:progress` (1 story, 4 answers):
 * the learner (`dev` on localhost) claims it at page load. The mock holds its first load
 * open (window.__kitLoadGate); the learner presses Return to Home Room with nothing
 * unsaved, and the page must still be here while the load is out. Releasing the load
 * inside the bounded wait lets the start-up (load, merge, first publish) finish, so the
 * existing progress reaches the tile with no play, before the navigation. Saves are
 * forwarded out of the page as they happen, since the page is left.
 */
async function leaveDuringDelayedFirstLoad(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const recorded: Save[] = [];
    let navigatedAfter = -1;
    await context.exposeFunction("__e2eKitSave", (s: Save) => { recorded.push(s); });
    await context.addInitScript(() => {
      if (location.hostname !== "localhost") return;
      const w = window as unknown as { __kitLoadGate?: Promise<void>; __releaseKitLoad?: () => void; __kitSaves?: unknown[]; __e2eKitSave?: (s: unknown) => void };
      w.__kitLoadGate = new Promise<void>((resolve) => { w.__releaseKitLoad = resolve; });
      const saves: unknown[] = [];
      const push = saves.push.bind(saves);
      saves.push = (...items: unknown[]) => {
        for (const item of items) w.__e2eKitSave?.(JSON.parse(JSON.stringify(item)));
        return push(...items);
      };
      w.__kitSaves = saves;
      if (!sessionStorage.getItem("e2e-seeded")) {
        sessionStorage.setItem("e2e-seeded", "1");
        localStorage.setItem("wordforge:progress", JSON.stringify({ storiesUnlocked: 1, correctTotal: 4 }));
      }
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(HOME_ROOM, (route) => {
      navigatedAfter = recorded.length;
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Home Room</title>" });
    });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof (window as unknown as Win).__wfAward === "function", null, { timeout: 30_000 });
    const stored = await page.evaluate(() => ({ legacy: localStorage.getItem("wordforge:progress"), scoped: localStorage.getItem("wordforge:progress:dev") }));
    expectEq(stored.legacy, null, "the legacy record was claimed and removed");
    expectEq(stored.scoped, JSON.stringify({ storiesUnlocked: 1, correctTotal: 4 }), "the learner's scoped record holds it");
    expectEq(await page.locator("#story-count").textContent(), "(1)", "the claimed story count shows");
    expectEq(recorded.length, 0, "no save while the first load is still out");
    const left = page.waitForURL(HOME_ROOM, { timeout: 10_000 });
    await page.getByRole("button", { name: "Return to Home Room", exact: true }).click();
    await page.waitForTimeout(400);
    expectEq(page.url().startsWith(base), true, "still here while the first load is out");
    await page.evaluate(() => (window as unknown as { __releaseKitLoad: () => void }).__releaseKitLoad());
    await left;
    expectEq(recorded.length, 1, "exactly one start-up save");
    expectEq(navigatedAfter, 1, "the start-up save happened before the navigation");
    expectEq(recorded[0].summary.headline, "4 words forged · 1 of 18 stories", "start-up save headline");
    expectEq(syncTotal(recorded[0].state), 4, "the synced state holds the legacy total");
    expectEq(recorded[0].state.correct.legacy, 4, "as the legacy bucket");
    expectEq(errors.length, 0, `page errors: ${errors.join(" | ")}`);
    log('dev: legacy progress claimed by the learner; leaving during a held first load waits for it, and the start-up save ("4 words forged · 1 of 18 stories") lands before navigating');
  } finally {
    await context.close();
  }
}

declare const correctTotal: number;
type TestKitWin = Window & {
  __toasts: string[];
  __wfSyncStarted?: boolean;
  __tsTestKit?: unknown;
  __e2eStoreLoad: () => Promise<{ offline: boolean; state: unknown; version: number }>;
  __e2eStoreSave: (state: unknown, version: number) => Promise<{ stored: string; merged?: unknown; version?: number }>;
};

const ARRIVAL = "Updated with your work from your other device.";

/**
 * Review Focus 3 and CDS3-004/007, on two browser contexts sharing one in-node store.
 *
 * The store is versioned like `save_progress_versioned`: a save names the version its page
 * last saw; a stale one is a conflict, which (as the kit does) is combined with the store's
 * copy and saved again. The seam's kit is versioned (deviceId, refresh, `merged` results)
 * and has a per-context offline switch: offline, load answers `{}`, saves stay "local" and
 * refresh reports no change. Only the kit is offline, so the page itself still loads.
 */
async function crossDeviceSync(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string) {
  let store: SyncedState = { v: 2, correct: {} };
  let version = 0;
  let conflicts = 0;
  const offline: Record<string, boolean> = { pc: false, phone: false };
  const opened: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const errors: string[] = [];

  async function device(name: "pc" | "phone"): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    opened.push(context);
    await context.exposeFunction("__e2eStoreLoad", () => ({ offline: offline[name], state: store, version }));
    await context.exposeFunction("__e2eStoreSave", (state: SyncedState, seen: number) => {
      if (offline[name]) return { stored: "local" };
      if (seen !== version) conflicts++; // combined with the newer copy, then saved
      store = mergeSync(store, state) as SyncedState;
      version++;
      return { stored: "server", merged: store, version };
    });
    // tsx (esbuild, keepNames) wraps named inner functions in `__name(...)`, a helper the page
    // does not have: give it one before the seam's init script runs.
    await context.addInitScript({ content: "window.__name = window.__name || ((f) => f);" });
    await context.addInitScript((deviceId: string) => {
      const w = window as unknown as TestKitWin;
      w.__toasts = [];
      type Merge = (a: unknown, b: unknown) => unknown;
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      w.__tsTestKit = {
        init: async ({ merge }: { merge: Merge }) => {
          let seen = 0;
          return {
            mock: true, // no portal cookie on localhost: the account checks pass, as with the mock
            user: { id: "dev", displayName: "E2E " + deviceId, role: "student" },
            totals: { xp: 0, gems: 0, level: 1, streak: 0 },
            launcherUrl: "https://class.travelschooling.com",
            deviceId,
            syncBroken: false,
            load: async () => {
              const r = await w.__e2eStoreLoad();
              if (r.offline) return {};
              seen = r.version;
              return r.state;
            },
            save: async (state: unknown) => {
              const sent = JSON.parse(JSON.stringify(state));
              const r = await w.__e2eStoreSave(sent, seen);
              if (r.stored !== "server") return { stored: r.stored };
              seen = r.version as number;
              return same(r.merged, merge(sent, sent)) ? { stored: "server" } : { stored: "server", merged: r.merged };
            },
            refresh: async (current: unknown) => {
              const r = await w.__e2eStoreLoad();
              if (r.offline || r.version === seen) return { changed: false };
              seen = r.version;
              const m = merge(current, r.state);
              return same(m, merge(current, current)) ? { changed: false } : { changed: true, state: m };
            },
            award: async () => ({ awarded_xp: 0, xp: 0, gems: 0, level: 1, streak: 0, level_up: false, new_achievements: [] }),
            unlock: async () => ({}),
            toast: (text: string) => { w.__toasts.push(text); },
          };
        },
      };
    }, name);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(`${base}/`, { waitUntil: "load" });
    await started(page);
    return page;
  }
  const started = (page: Page) => page.waitForFunction(() => (window as unknown as TestKitWin).__wfSyncStarted === true, null, { timeout: 30_000 });
  const total = (page: Page) => page.evaluate(() => correctTotal);
  const answer = (page: Page) => page.evaluate(() => (window as unknown as Win).maybeUnlockStory!());
  async function storeReaches(n: number, what: string) {
    const until = Date.now() + 10_000;
    while (syncTotal(store) !== n) {
      if (Date.now() > until) throw new Error(`${what}: the store total stayed ${syncTotal(store)}, expected ${n}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  try {
    const pc = await device("pc");
    const phone = await device("phone");
    expectEq(await total(pc), 0, "pc starts empty");

    // The phone answers twice; the pc tab, left open, picks them up when shown again.
    await answer(phone);
    await answer(phone);
    await storeReaches(2, "the phone's answers reach the server");
    expectEq(await total(pc), 0, "the pc has not looked yet");
    await pc.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await pc.waitForFunction(() => correctTotal === 2, null, { timeout: 10_000 });
    expectEq((await pc.evaluate(() => (window as unknown as TestKitWin).__toasts)).includes(ARRIVAL), true, "the pc shows the arrival notice");
    log("dev (two contexts): the phone answers 2; the pc tab shown again shows +2 and the notice");

    // The pc answers while its kit is offline: kept locally, then sent on `online` alone.
    offline.pc = true;
    await answer(pc);
    await pc.waitForTimeout(500);
    expectEq(await total(pc), 3, "the pc counts its offline answer");
    expectEq(syncTotal(store), 2, "nothing reached the server while offline");
    offline.pc = false;
    await pc.evaluate(() => window.dispatchEvent(new Event("online")));
    await storeReaches(3, "reconnecting sends the offline answer with no further answer");
    log("dev (two contexts): an answer made offline reaches the server on the online event, with no further answer");

    // Reopen the pc page with its kit offline: the total comes from the local synced state.
    offline.pc = true;
    await pc.reload({ waitUntil: "load" });
    await started(pc);
    expectEq(await total(pc), 3, "reopened offline, the pc shows its local total");
    expectEq(await pc.locator("#story-count").textContent(), "(1)", "and the story it unlocks");
    const entries = await pc.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("wordforge:sync:dev:")).sort());
    expectEq(entries.includes("wordforge:sync:dev:legacy"), true, `the one-time legacy baseline entry is kept (${entries.join(", ")})`);
    log("dev (two contexts): reopened with the kit offline, the pc shows 3 from its local synced state");

    // The phone, last in step at version 2, answers again: its save conflicts with the pc's,
    // is combined, and the phone adopts the pc's answer from the save's result.
    await answer(phone);
    await storeReaches(4, "the phone's stale save is combined, not lost");
    await phone.waitForFunction(() => correctTotal === 4, null, { timeout: 10_000 });
    expectEq(conflicts >= 1, true, `the stale save was a conflict (${conflicts})`);
    expectEq((await phone.evaluate(() => (window as unknown as TestKitWin).__toasts)).includes(ARRIVAL), true, "the phone shows the arrival notice");
    expectEq(errors.length, 0, `page errors: ${errors.join(" | ")}`);
    log("dev (two contexts): a stale phone save conflicts, is combined to 4, and the phone adopts the pc's answer");
  } finally {
    for (const c of opened) await c.close();
  }
}

/** Return to Home Room: dialog while a word is half-built, straight home once it is not. */
async function homeRoomButton(page: Page) {
  const home = page.getByRole("button", { name: "Return to Home Room", exact: true });
  expectEq(await home.isVisible(), true, "Return to Home Room button visible");

  // A story unlocked earlier opens its modal ~0.9 s later and covers the page: close any.
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelectorAll(".story-overlay").forEach((o) => o.remove()));

  // A fresh Forge round, then one tile snapped into a slot: a half-built word.
  await page.evaluate(() => (window as unknown as Win).setMode!("forge"));
  await page.locator("#bank .tile").first().click();

  const dialog = page.getByRole("dialog");
  await home.click();
  await dialog.waitFor({ state: "visible" });
  expectEq(await dialog.getAttribute("aria-modal"), "true", "dialog aria-modal");
  expectEq(await page.getByRole("dialog", { name: "Not saved yet", exact: true }).isVisible(), true, "dialog is labelled by its heading");
  const text = (await dialog.textContent()) ?? "";
  expectEq(text.includes("Your word is not finished. Finish it to keep it."), true, "dialog says the word is not finished");
  expectEq(await page.evaluate(() => document.activeElement?.id), "leave-stay", "focus moved into the dialog");

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  expectEq(await page.evaluate(() => document.activeElement?.id), "home-room", "Escape returns focus to the button");

  await home.click();
  await dialog.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Stay and save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  expectEq(await page.evaluate(() => document.activeElement?.id), "home-room", "Stay returns focus to the button");
  expectEq(await page.locator("#stick .slot.filled").count(), 1, "staying keeps the half-built word");
  log("dev: a half-built word opens the leave dialog; Escape and Stay keep the learner here");

  // Clear the word: now the button goes home, with no beforeunload prompt on the way.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const prompts: string[] = [];
  page.on("dialog", (d) => {
    prompts.push(d.type());
    void d.dismiss();
  });
  await page.route(HOME_ROOM, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Home Room</title>" }));
  await Promise.all([page.waitForURL(HOME_ROOM, { timeout: 10_000 }), home.click()]);
  expectEq(page.url(), HOME_ROOM, "Return to Home Room navigates to the portal");
  expectEq(prompts.length, 0, `browser prompts on a clean leave: ${prompts.join(", ")}`);
  log("dev: with nothing unsaved, Return to Home Room goes to the portal without a prompt");
}

async function gameInDevelopmentMode() {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = startNext(["dev", "-p", String(port)], { NEXT_PUBLIC_TS_KIT: "mock", NODE_ENV: "development" });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await waitForServer(base, 90_000);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/`, { waitUntil: "load" });
    expectEq(await page.title(), "Read Words — Latin Roots", "title");
    expectEq(await page.locator('link[rel="manifest"]').getAttribute("crossorigin"), "use-credentials", "manifest link credentials");
    await page.waitForFunction(() => typeof (window as unknown as Win).__wfAward === "function", null, { timeout: 30_000 });
    expectEq(await page.locator("#kit-banner").isVisible(), false, "kit banner hidden");
    expectEq((await page.locator("#stage .card").count()) > 0, true, "the Forge stage rendered a card");
    log("dev: game booted with the mock kit; manifest link carries use-credentials");

    // Story unlock: the game's own counter unlocks a story every third correct answer.
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.maybeUnlockStory!();
      w.maybeUnlockStory!();
      w.maybeUnlockStory!();
    });
    let a = await awards(page);
    const stories = a.filter((x) => x.event === "story_unlocked");
    expectEq(stories.length, 1, "story_unlocked after three correct answers");
    expectEq(stories[0].detail.story, 1, "first story index");
    log("dev: story_unlocked once after three correct answers");
    const third = await lastSaveIs(page, "3 words forged · 1 of 18 stories");
    expectEq(syncTotal(third.state), 3, "tile save: the synced total");
    expectEq(third.state.v, 2, "tile save: the synced (v2) shape");
    expectEq(third.summary.percent, 6, "tile percent");
    log('dev: tile save "3 words forged · 1 of 18 stories"');

    // A correct forge: fill the picks from the current word, then check. `current` and
    // `forgePicks` are top-level `let` bindings of the classic script (global lexical
    // scope, not window properties), so they are read as bare identifiers.
    const expectedWord = await page.evaluate(() => {
      const word = current.w;
      forgePicks.prefix = word[1] || null;
      forgePicks.stem = word[2];
      forgePicks.suffix = word[3] || null;
      (window as unknown as Win).checkForge!();
      return word[0];
    });
    a = await awards(page);
    const forged = a.filter((x) => x.event === "word_forged");
    expectEq(forged.length, 1, "word_forged after a correct forge");
    expectEq(forged[0].detail.word, expectedWord, "word_forged names the word");
    log(`dev: word_forged for "${expectedWord}"`);
    await lastSaveIs(page, "4 words forged · 1 of 18 stories");
    const kept = await page.evaluate(() => {
      const entries: Record<string, unknown> = {};
      for (const k of Object.keys(localStorage)) if (k.startsWith("wordforge:")) entries[k] = JSON.parse(localStorage.getItem(k)!);
      return entries;
    });
    const sessionKeys = Object.keys(kept).filter((k) => /^wordforge:sync:dev:(?!legacy$|known$)[^:]+$/.test(k));
    expectEq(sessionKeys.length, 1, `one session entry (${Object.keys(kept).join(", ")})`);
    expectEq(JSON.stringify(Object.values((kept[sessionKeys[0]] as SyncedState).correct)), "[4]", "the session entry holds only its own bucket, 4 answers");
    expectEq(syncTotal(kept["wordforge:sync:dev:known"]), 4, "the shared known entry holds the merged state");
    expectEq(JSON.stringify(kept["wordforge:sync:dev:legacy"]), JSON.stringify({ v: 2, correct: {} }), "the legacy import is marked done");
    expectEq(kept["wordforge:progress:dev"], undefined, "the old aggregate record is frozen (never written)");
    expectEq(kept["wordforge:progress"], undefined, "nothing under the legacy key");
    log(`dev: tile save "4 words forged · 1 of 18 stories"; local progress in this session's own entry (wordforge:sync:dev:<session>)`);

    const seduce = await page.evaluate(() => WORDS.find((w) => w[0] === "seduce"));
    expectEq(seduce?.[4], "lead apart", "seduce literal sense");
    expectEq(seduce?.[5], "to lead aside", "seduce definition");
    log('dev: seduce reads "to lead aside"');

    // Decode: a correct answer shows uplifting praise from the list, never the same twice running.
    // Story cards (one per three correct answers) open ~0.9 s after the answer and cover the
    // page; they are closed around this check.
    const closeStories = async () => {
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.querySelectorAll(".story-overlay").forEach((o) => o.remove()));
    };
    await closeStories();
    await page.evaluate(() => (window as unknown as Win).setMode!("decode"));
    const praiseList = await page.evaluate(() => PRAISE);
    const shown: string[] = [];
    for (let i = 0; i < 2; i++) {
      await page.locator(".choice").first().waitFor({ timeout: 10_000 });
      const correct = await page.evaluate(() => (current as unknown as { correct: string }).correct);
      await page.locator(".choice", { hasText: new RegExp(`^${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
      shown.push(((await page.locator("#fb .praise").textContent()) ?? "").trim());
      await closeStories();
      await page.locator("#nextbtn").click();
    }
    for (const p of shown) expectEq(praiseList.includes(p), true, `praise "${p}" is from the list`);
    expectEq(shown[0] !== shown[1], true, `two correct Decode answers show different praise (${shown.join(" / ")})`);
    log(`dev: Decode praise "${shown[0]}", then "${shown[1]}"`);

    await homeRoomButton(page);

    expectEq(errors.length, 0, `page errors: ${errors.join(" | ")}`);

    for (const p of ["/README.md", "/word-forge-500-words.md", "/docs/plans/2026-09-23-class-standard-phase4.md"]) {
      const res = await fetch(base + p, { redirect: "manual" });
      expectEq(res.status, 404, `GET ${p} (dev, gate bypassed)`);
    }
    for (const p of ["/index.html", "/sw.js", "/manifest.webmanifest"]) {
      expectEq((await fetch(`${base}${p}`, { redirect: "manual" })).status, 200, `GET ${p}`);
    }
    log("dev: repository files are 404, the game files are 200");

    await leaveDuringDelayedFirstLoad(browser, base);
    await crossDeviceSync(browser, base);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      stopServer(server, port);
    }
  }
}

(async () => {
  await gateInProductionMode();
  await gameInDevelopmentMode();
  log("PASS");
})().catch((err) => {
  console.error(`[e2e] FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
