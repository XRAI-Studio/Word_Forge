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
