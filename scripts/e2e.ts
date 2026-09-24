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
 *      files and the manifest link's credentials attribute.
 *
 *   npm run e2e            (needs `npx playwright install chromium` once)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { chromium, type Page } from "playwright";

const PORTAL_LOGIN = "https://class.travelschooling.com/login?next=";
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

    for (const asset of ["/sw.js", "/kit.js", "/sw-policy.js", "/fonts/nunito.woff2", "/icons/icon-192.png"]) {
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
type Win = Window & { __kitAwards?: Award[]; __wfAward?: unknown; checkForge?: () => void; maybeUnlockStory?: () => void };
// Top-level `let` bindings of the game's classic script, visible to evaluated code by name.
declare const current: { w: string[] };
declare const forgePicks: { prefix: string | null; stem: string | null; suffix: string | null };

async function awards(page: Page): Promise<Award[]> {
  return page.evaluate(() => (window as unknown as Win).__kitAwards ?? []);
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
    expectEq(await page.title(), "Word Forge — Latin Roots", "title");
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

    expectEq(errors.length, 0, `page errors: ${errors.join(" | ")}`);

    for (const p of ["/README.md", "/word-forge-500-words.md", "/docs/plans/2026-09-23-class-standard-phase4.md"]) {
      const res = await fetch(base + p, { redirect: "manual" });
      expectEq(res.status, 404, `GET ${p} (dev, gate bypassed)`);
    }
    for (const p of ["/index.html", "/sw.js", "/manifest.webmanifest"]) {
      expectEq((await fetch(`${base}${p}`, { redirect: "manual" })).status, 200, `GET ${p}`);
    }
    log("dev: repository files are 404, the game files are 200");
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
