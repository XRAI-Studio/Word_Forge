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

test('a non-200 response is not, and a missing response is not', () => {
  assert.equal(cacheablePage(res({ status: 307 }), ORIGIN), false);
  assert.equal(cacheablePage(res({ status: 404 }), ORIGIN), false);
  assert.equal(cacheablePage(null, ORIGIN), false);
  assert.equal(cacheablePage(res({ url: 'not a url' }), ORIGIN), false);
});
