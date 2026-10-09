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
 *      progress, no play) still happens before the navigation (R001, R007). Then a phone
 *      pass: 375 x 667 in the light and dark themes (portal cookie ts_theme) with layout,
 *      font-size and tap-target checks on every tab and on the not-found page; screenshots
 *      go to E2E_SHOT_DIR (default: the OS temp directory), not the repository.
 *
 *   npm run e2e            (needs `npx playwright install chromium` once)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
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
declare const fcDeck: string[][];
declare const PREFIXES: string[][];
declare const STEMS: string[][];
declare const SUFFIXES: string[][];
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assigned in page.evaluate (the game's own binding)
declare let fcIdx: number;

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

/**
 * Phone pass (class standard §6.4): 375 × 667 in both themes, the theme chosen by the
 * portal's `ts_theme` cookie on this origin. Asserts the head script's data-theme, no
 * sideways page scroll on every tab, reading text ≥ 16 px and primary controls ≥ 44 × 44
 * on the named selectors (tabs, answer choices, flashcard faces), the three snap slots on
 * one line for every word in the data, the big word inside its card for every word, and the
 * flashcard faces sharing one grid cell that grows to fit the longest definition and literal
 * meaning. Then the not-found page. Screenshots go to E2E_SHOT_DIR (default: the OS temp
 * directory), never the repository.
 */
async function phonePass(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string) {
  const shotDir = process.env.E2E_SHOT_DIR ?? path.join(os.tmpdir(), "wordforge-e2e");
  mkdirSync(shotDir, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    try {
      await context.addCookies([{ name: "ts_theme", value: theme, url: base }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (name: string) => page.screenshot({ path: path.join(shotDir, `phone-${theme}-${name}.png`), fullPage: true });
      const themeIs = async (where: string) => {
        const t = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, pref: document.documentElement.dataset.themePref }));
        expectEq(t.theme, theme, `${theme} ${where}: data-theme`);
        expectEq(t.pref, theme, `${theme} ${where}: data-theme-pref`);
      };
      const noOverflow = async (where: string) => {
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        expectEq(o.sw <= o.iw, true, `${theme} ${where}: page scrollWidth ${o.sw} <= ${o.iw}`);
      };
      /** Each element matching `sel`: computed font-size ≥ minFont, and (if given) box ≥ minBox square. */
      const sizes = async (sel: string, minFont: number, minBox: number | null, where: string) => {
        const els = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0).map((e) => {
          const r = e.getBoundingClientRect();
          return { text: (e.textContent ?? "").trim().slice(0, 30), fs: parseFloat(getComputedStyle(e).fontSize), w: r.width, h: r.height };
        }), sel);
        expectEq(els.length > 0, true, `${theme} ${where}: ${sel} present`);
        for (const e of els) {
          expectEq(e.fs >= minFont, true, `${theme} ${where}: ${sel} "${e.text}" font ${e.fs}px >= ${minFont}`);
          if (minBox !== null) expectEq(e.w >= minBox && e.h >= minBox, true, `${theme} ${where}: ${sel} "${e.text}" ${e.w.toFixed(1)}x${e.h.toFixed(1)} >= ${minBox}`);
        }
      };

      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.waitForFunction(() => typeof (window as unknown as Win).__wfAward === "function", null, { timeout: 30_000 });
      await themeIs("game");
      await noOverflow("forge");
      await sizes("nav button", 16, 44, "tabs");
      await sizes(".btn", 16, 44, "forge buttons");

      // Forge: every word in the data, built in full, keeps its slots on one line.
      const forgeBad = await page.evaluate(() => {
        const bad: string[] = [];
        const orig = Math.random;
        const g = window as unknown as { renderForge: () => void; renderBank: () => void };
        for (let i = 0; i < WORDS.length; i++) {
          let first = true;
          Math.random = () => { if (first) { first = false; return (i + 0.5) / WORDS.length; } return orig(); };
          g.renderForge();
          Math.random = orig;
          const w = current.w;
          forgePicks.prefix = w[1] || null;
          forgePicks.stem = w[2];
          forgePicks.suffix = w[3] || null;
          g.renderBank();
          const slots = [...document.querySelectorAll<HTMLElement>("#stick .slot")];
          const tops = new Set(slots.map((s) => Math.round(s.getBoundingClientRect().top)));
          const stick = document.getElementById("stick")!;
          if (tops.size !== 1 || slots.some((s) => s.scrollWidth > s.clientWidth) || stick.scrollWidth > stick.clientWidth
            || document.documentElement.scrollWidth > window.innerWidth) bad.push(String(w[0]));
        }
        forgePicks.prefix = forgePicks.stem = forgePicks.suffix = null;
        g.renderBank();
        return { bad, n: WORDS.length };
      });
      expectEq(forgeBad.bad.length, 0, `${theme} forge: slots on one line for every word (failed: ${forgeBad.bad.join(", ")})`);
      await sizes(".prompt-label", 16, null, "forge prompt");
      await sizes(".tile small", 16, null, "forge tile meanings");
      await shot("forge");
      // Every word part in the data as a tile (the word-part definitions are reading text):
      // each fits its tile and the bank, at 16 px.
      const tileBad = await page.evaluate(() => {
        const bank = document.getElementById("bank")!;
        const saved = bank.innerHTML;
        const lists: Array<[string, string[][]]> = [["prefix", PREFIXES], ["stem", STEMS], ["suffix", SUFFIXES]];
        bank.innerHTML = lists.flatMap(([t, l]) => l.map((x) => `<button class="tile tile-${t}">${x[0]}<small>${x[1]}</small></button>`)).join("");
        const bad = [...bank.querySelectorAll<HTMLElement>(".tile")]
          .filter((b) => b.scrollWidth > b.clientWidth || parseFloat(getComputedStyle(b.querySelector("small")!).fontSize) < 16)
          .map((b) => b.textContent ?? "");
        if (bank.scrollWidth > bank.clientWidth || document.documentElement.scrollWidth > window.innerWidth) bad.push("(bank overflows)");
        const n = bank.children.length;
        bank.innerHTML = saved;
        return { bad, n };
      });
      expectEq(tileBad.bad.length, 0, `${theme} forge: every part tile fits at 16 px (failed: ${tileBad.bad.join(", ")})`);

      // Decode: answer choices and the big word, for every word in the data.
      await page.evaluate(() => (window as unknown as Win).setMode!("decode"));
      await themeIs("after switching to Decode");
      await noOverflow("decode");
      await sizes(".choice", 16, 44, "decode");
      await sizes(".subtext", 16, null, "decode");
      await sizes(".prompt-label", 16, null, "decode question");
      const decodeBad = await page.evaluate(() => {
        const bad: string[] = [];
        const orig = Math.random;
        const g = window as unknown as { renderDecode: () => void };
        for (let i = 0; i < WORDS.length; i++) {
          let first = true;
          Math.random = () => { if (first) { first = false; return (i + 0.5) / WORDS.length; } return orig(); };
          g.renderDecode();
          Math.random = orig;
          const big = document.querySelector<HTMLElement>(".bigword")!;
          if (big.scrollWidth > big.clientWidth || document.documentElement.scrollWidth > window.innerWidth) bad.push(String(current.w[0]));
        }
        return bad;
      });
      expectEq(decodeBad.length, 0, `${theme} decode: the big word fits for every word (failed: ${decodeBad.join(", ")})`);
      await shot("decode");

      // Lexicon.
      await page.evaluate(() => (window as unknown as Win).setMode!("lexicon"));
      await noOverflow("lexicon");
      await sizes(".lex-tabs button", 13, 44, "lexicon tabs");
      await sizes(".lex-item .mean", 16, null, "lexicon");
      await shot("lexicon");

      // Flashcards: the longest definition and literal meaning, front and back, then the
      // longest part meaning.
      await page.evaluate(() => (window as unknown as Win).setMode!("cards"));
      await themeIs("after switching to Flashcards");
      await sizes(".lex-tabs button", 13, 44, "flashcard tabs");
      await sizes(".fc-nav .btn", 16, 44, "flashcard buttons");
      type Fc = { faces: Array<{ pos: string; area: string; top: number; h: number; over: number }>; inner: string; card: { w: number; h: number; right: number }; stage: number };
      const flashcard = async (pick: string): Promise<Fc> => page.evaluate((p) => {
        const g = window as unknown as { setFcTab: (t: string) => void; showCard: () => void; flipCard: () => void };
        const [tab, field] = p.split(":");
        g.setFcTab(tab);
        const deck = fcDeck;
        let best = 0;
        deck.forEach((c, i) => { if (c[Number(field)].length > deck[best][Number(field)].length) best = i; });
        fcIdx = best;
        g.showCard();
        const faces = [...document.querySelectorAll<HTMLElement>(".fc-face")].map((f) => {
          const r = f.getBoundingClientRect();
          return { pos: getComputedStyle(f).position, area: getComputedStyle(f).gridArea, top: r.top, h: r.height, over: f.scrollHeight - f.clientHeight };
        });
        const card = document.getElementById("fcard")!.getBoundingClientRect();
        const stage = document.querySelector(".fc-stage")!.getBoundingClientRect().right;
        return { faces, inner: getComputedStyle(document.querySelector(".fc-inner")!).display, card: { w: card.width, h: card.height, right: card.right }, stage };
      }, pick);
      const checkCard = async (fc: Fc, where: string) => {
        expectEq(fc.inner, "grid", `${theme} ${where}: .fc-inner is a grid`);
        expectEq(fc.faces.length, 2, `${theme} ${where}: two faces`);
        for (const f of fc.faces) {
          expectEq(f.pos === "absolute", false, `${theme} ${where}: faces are not absolutely positioned`);
          expectEq(f.area.startsWith("1 / 1"), true, `${theme} ${where}: face grid-area ${f.area}`);
          expectEq(f.over <= 0, true, `${theme} ${where}: face content fits (overflow ${f.over}px)`);
        }
        expectEq(Math.abs(fc.faces[0].top - fc.faces[1].top) < 1 && Math.abs(fc.faces[0].h - fc.faces[1].h) < 1, true, `${theme} ${where}: faces share one cell`);
        expectEq(fc.card.h >= 270, true, `${theme} ${where}: flashcard height ${fc.card.h} >= 270`);
        expectEq(fc.card.w >= 44, true, `${theme} ${where}: flashcard is a large tap target`);
        expectEq(fc.card.right <= fc.stage + 0.5, true, `${theme} ${where}: flashcard inside its card`);
        await noOverflow(where);
      };
      await checkCard(await flashcard("words:6"), "flashcard, longest definition");
      await sizes(".fc-def", 16, null, "flashcard definition");
      await sizes(".fc-lit", 16, null, "flashcard literal meaning");
      await shot("flashcard-front");
      await page.evaluate(() => (window as unknown as { flipCard: () => void }).flipCard());
      await page.waitForTimeout(700);
      await shot("flashcard-back");
      await checkCard(await flashcard("words:5"), "flashcard, longest literal meaning");
      await sizes(".fc-lit", 16, null, "flashcard literal meaning");
      await checkCard(await flashcard("all:2"), "flashcard, longest part meaning");
      await sizes(".fc-back .fc-mean", 16, null, "flashcard part meaning");
      await sizes(".fc-back .fc-ex", 16, null, "flashcard example");

      // Stories.
      // The story card's button: its focus ring sits on the card surface and must reach 3:1.
      const ring = await page.evaluate(() => {
        (window as unknown as { showStoryModal: (i: number, isNew: boolean) => void }).showStoryModal(0, false);
        const btn = document.querySelector<HTMLElement>(".story-card .btn")!;
        const out = { ring: getComputedStyle(btn).getPropertyValue("--focus").trim(), card: getComputedStyle(btn.closest(".story-card")!).backgroundColor };
        document.querySelectorAll(".story-overlay").forEach((o) => o.remove());
        return out;
      });
      const rgb = (c: string) => c.startsWith("#") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const [hiL, loL] = [lum(rgb(ring.ring)), lum(rgb(ring.card))].sort((x, y) => y - x);
      const ringRatio = (hiL + 0.05) / (loL + 0.05);
      expectEq(ringRatio >= 3, true, `${theme} story card focus ring ${ring.ring} on ${ring.card}: ${ringRatio.toFixed(2)} >= 3`);

      await page.evaluate(() => (window as unknown as Win).setMode!("stories"));
      await noOverflow("stories");
      await themeIs("after switching to Stories");
      await shot("stories");
      expectEq(errors.length, 0, `${theme} phone page errors: ${errors.join(" | ")}`);

      // The shell's not-found page follows the theme too.
      await page.goto(`${base}/README.md`, { waitUntil: "load" });
      await themeIs("not-found page");
      await noOverflow("not-found page");
      await shot("not-found");
      log(`dev: phone 375x667 ${theme}: data-theme, no sideways scroll, tabs/choices/buttons >= 44 px, reading text >= 16 px, slots on one line for ${forgeBad.n} words, flashcard faces share a grid cell; not-found page themed`);
    } finally {
      await context.close();
    }
  }
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
    await phonePass(browser, base);
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
