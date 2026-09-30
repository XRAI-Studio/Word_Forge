import test from 'node:test';
import assert from 'node:assert/strict';

// sw-policy.js is a plain script that sets self.WF_POLICY (sw.js loads it with
// importScripts). Give it a `self` and import it for its side effect.
globalThis.self = globalThis;
await import('../public/sw-policy.js');
const { cacheablePage } = globalThis.WF_POLICY;

const ORIGIN = 'https://wordforge.travelschooling.com';
const res = (o) => ({ status: 200, redirected: false, url: `${ORIGIN}/`, ...o });

test('a 200, non-redirected, same-origin page response is cacheable', () => {
  assert.equal(cacheablePage(res(), ORIGIN), true);
  assert.equal(cacheablePage(res({ url: `${ORIGIN}/index.html` }), ORIGIN), true);
});

test('a redirected response is not (the gate sent the fetch to the portal login)', () => {
  assert.equal(cacheablePage(res({ redirected: true, url: 'https://class.travelschooling.com/login?next=x' }), ORIGIN), false);
  assert.equal(cacheablePage(res({ redirected: true }), ORIGIN), false);
});

test('a response from another origin is not', () => {
  assert.equal(cacheablePage(res({ url: 'https://class.travelschooling.com/' }), ORIGIN), false);
});

test('install-time precache: a redirected 200 login page fetched for ./index.html is refused by the same policy', () => {
  // The gate redirected the precache fetch; the response is a 200 from the portal login.
  const redirectedLogin = { status: 200, redirected: true, url: 'https://class.travelschooling.com/login?next=https%3A%2F%2Fwordforge.travelschooling.com%2Findex.html' };
  assert.equal(cacheablePage(redirectedLogin, ORIGIN), false);
});

test('sw.js warms every shell entry through the policy and nowhere else decides by response.ok', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const warm = src.slice(src.indexOf('function warm('), src.indexOf('self.addEventListener("install"'));
  assert.match(warm, /WF_POLICY\.cacheablePage\(response, self\.location\.origin\)/);
  assert.doesNotMatch(warm, /response\.ok/);
  assert.doesNotMatch(warm, /response\.url/);
});

test('a non-200 response is not, and a missing response is not', () => {
  assert.equal(cacheablePage(res({ status: 307 }), ORIGIN), false);
  assert.equal(cacheablePage(res({ status: 404 }), ORIGIN), false);
  assert.equal(cacheablePage(null, ORIGIN), false);
  assert.equal(cacheablePage(res({ url: 'not a url' }), ORIGIN), false);
});

// ---- versioned page scripts (inspection WF-HR-001) ----

const ORIGIN_ROOT = `${ORIGIN}/`;

async function source(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
}

/** The SHELL entries of a sw.js source, resolved to absolute URLs. */
function shellOf(src) {
  const block = src.slice(src.indexOf('const SHELL = ['), src.indexOf('];', src.indexOf('const SHELL = [')));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => new URL(m[1], ORIGIN_ROOT).href);
}

/** Every same-origin script the page loads: classic <script src> and static module imports. */
function pageScripts(html) {
  const urls = [];
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) urls.push(m[1]);
  for (const m of html.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) urls.push(m[1]);
  return urls.map((u) => new URL(u, ORIGIN_ROOT)).filter((u) => u.origin === ORIGIN).map((u) => u.href);
}

// Older workers' caches as installed browsers hold them: each one's SHELL (v2 frozen at
// 0d9b9bd, v3 at 3fb30c4, v4 at 88af2e4, v5 at c560456), which is also everything that
// version's page fetched at run time.
const OLD_WORKER_CACHES = {
  'word-forge-v2': [
    './', './index.html', './manifest.webmanifest', './kit.js', './sw-policy.js',
    './fonts/baloo2.woff2', './fonts/nunito.woff2',
    './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ],
  'word-forge-v3': [
    './', './index.html', './manifest.webmanifest',
    './kit.js?v=3', './progress-store.js?v=3', './leave-guard.js?v=3', './sw-policy.js',
    './fonts/baloo2.woff2', './fonts/nunito.woff2',
    './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ],
  'word-forge-v4': [
    './', './index.html', './manifest.webmanifest',
    './kit.js?v=4', './progress-store.js?v=4', './leave-guard.js?v=4', './sw-policy.js',
    './fonts/baloo2.woff2', './fonts/nunito.woff2',
    './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ],
  'word-forge-v5': [
    './', './index.html', './manifest.webmanifest',
    './kit.js?v=5', './progress-store.js?v=5', './leave-guard.js?v=5', './sw-policy.js',
    './fonts/baloo2.woff2', './fonts/nunito.woff2',
    './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ],
};

/** How an old worker answers a script request: caches.match (exact URL, query included), else network. */
function oldWorkerServes(cache, url) {
  return OLD_WORKER_CACHES[cache].map((p) => new URL(p, ORIGIN_ROOT).href).includes(url) ? 'old-cache' : 'network';
}

test('an old v2, v3, v4 or v5 worker never pairs the new page with a script from its cache', async () => {
  const scripts = pageScripts(await source('index.html'));
  assert.ok(scripts.length >= 3, `found the page scripts: ${scripts.join(', ')}`);
  for (const cache of Object.keys(OLD_WORKER_CACHES)) {
    for (const url of scripts) assert.equal(oldWorkerServes(cache, url), 'network', `${url} would come from ${cache}`);
  }
});

test('every page script is versioned with the cache version and precached under that exact URL', async () => {
  const sw = await source('sw.js');
  const version = sw.match(/const CACHE = "word-forge-v(\d+)";/)[1];
  const shell = shellOf(sw);
  for (const url of pageScripts(await source('index.html'))) {
    assert.equal(new URL(url).searchParams.get('v'), version, `${url} carries ?v=${version}`);
    assert.ok(shell.includes(url), `${url} is in SHELL`);
  }
  // No unversioned copy of a page script is precached alongside (it would be stale later).
  for (const bare of ['kit.js', 'progress-store.js', 'leave-guard.js']) {
    assert.ok(!shell.includes(new URL(bare, ORIGIN_ROOT).href), `SHELL has no bare ${bare}`);
  }
});

test('sw.js: the cache is bumped past v5 and every older cache is cleaned up', async () => {
  const src = await source('sw.js');
  assert.match(src, /const CACHE = "word-forge-v6";/);
  assert.match(src, /const OLD_CACHES = \["word-forge-v1", "word-forge-v2", "word-forge-v3", "word-forge-v4", "word-forge-v5"\];/);
  assert.ok(shellOf(src).includes(new URL('./sw-policy.js', ORIGIN_ROOT).href), 'the worker policy is precached');
});
