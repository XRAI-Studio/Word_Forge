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
 *
 *   npm run e2e            (needs `npx playwright install chromium` once)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { chromium, type Page } from "playwright";

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
type Save = { state: { rev: number; storiesUnlocked: number; correctTotal: number }; summary: { headline: string; percent: number } };
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
    expectEq(recorded[0].state.rev, 4, "rev = correctTotal");
    expectEq(errors.length, 0, `page errors: ${errors.join(" | ")}`);
    log('dev: legacy progress claimed by the learner; leaving during a held first load waits for it, and the start-up save ("4 words forged · 1 of 18 stories") lands before navigating');
  } finally {
    await context.close();
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
    expectEq(third.state.rev, 3, "tile save rev = correctTotal");
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
    expectEq(
      await page.evaluate(() => localStorage.getItem("wordforge:progress:dev")),
      JSON.stringify({ storiesUnlocked: 1, correctTotal: 4 }),
      "progress is kept under the learner's key",
    );
    expectEq(await page.evaluate(() => localStorage.getItem("wordforge:progress")), null, "nothing under the legacy key");
    log('dev: tile save "4 words forged · 1 of 18 stories"; local progress under wordforge:progress:dev');

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
