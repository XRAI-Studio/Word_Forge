import test from 'node:test';
import assert from 'node:assert/strict';

// progress-store.js is a plain script that sets self.WF_PROGRESS (index.html loads it with a
// <script> tag). Give it a `self` and import it for its side effect.
globalThis.self = globalThis;
await import('../public/progress-store.js');
const { createProgressSaver } = globalThis.WF_PROGRESS;

const KEY = 'wordforge:progress';

function memoryStorage() {
  const data = new Map();
  return {
    data,
    fail: false,
    setItem(k, v) {
      if (this.fail) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
  };
}

test('a successful save writes the snapshot and reports true', () => {
  const store = memoryStorage();
  const saver = createProgressSaver(() => store, KEY);
  assert.equal(saver.save({ storiesUnlocked: 1, correctTotal: 3 }), true);
  assert.equal(saver.unsaved(), false);
  assert.deepEqual(JSON.parse(store.data.get(KEY)), { storiesUnlocked: 1, correctTotal: 3 });
});

test('a throwing setItem reports false and marks progress unsaved', () => {
  const store = memoryStorage();
  store.fail = true;
  const saver = createProgressSaver(() => store, KEY);
  assert.equal(saver.save({ storiesUnlocked: 0, correctTotal: 1 }), false);
  assert.equal(saver.unsaved(), true);
  assert.equal(store.data.has(KEY), false);
});

test('the next save retries the full snapshot and clears the mark on success', () => {
  const store = memoryStorage();
  const saver = createProgressSaver(() => store, KEY);
  store.fail = true;
  saver.save({ storiesUnlocked: 0, correctTotal: 1 });
  saver.save({ storiesUnlocked: 0, correctTotal: 2 });
  assert.equal(saver.unsaved(), true);
  store.fail = false;
  assert.equal(saver.save({ storiesUnlocked: 1, correctTotal: 3 }), true);
  assert.equal(saver.unsaved(), false);
  assert.deepEqual(JSON.parse(store.data.get(KEY)), { storiesUnlocked: 1, correctTotal: 3 });
});

test('a storage that throws on access (privacy mode) is a failed save, not a crash', () => {
  const saver = createProgressSaver(() => {
    throw new Error('SecurityError');
  }, KEY);
  assert.equal(saver.save({ storiesUnlocked: 0, correctTotal: 1 }), false);
  assert.equal(saver.unsaved(), true);
});

// ---- per-learner progress (work order 2026-09-30, R001) ----

const { learnerId, loadLearnerProgress, progressKey, sessionUserId, LEGACY_KEY } = globalThis.WF_PROGRESS;
const kit = await import('../public/kit.js');

/** A Storage-like map with getItem/setItem/removeItem; `failWrites` makes setItem throw. */
function fullStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    failWrites: false,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { if (this.failWrites) throw new Error('QuotaExceededError'); data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
  };
}
function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256' })}.${b64({ sub, approved: true })}.sig`;
}
function cookieFor(sub) {
  return 'sb-abc-auth-token=' + encodeURIComponent(JSON.stringify({ access_token: jwt(sub), token_type: 'bearer' }));
}

test('sessionUserId reads the cookie exactly as kit.js does (plain, chunked, base64-prefixed, garbage, empty)', () => {
  const payload = Buffer.from(JSON.stringify({ access_token: jwt('user-7') })).toString('base64url');
  const b64 = 'base64-' + payload;
  const cut = Math.floor(b64.length / 2);
  const cases = [
    cookieFor('user-42'),
    `other=1; sb-abc-auth-token.1=${b64.slice(cut)}; sb-abc-auth-token.0=${b64.slice(0, cut)}`,
    'theme=dark',
    'sb-abc-auth-token=not-json',
    'sb-abc-auth-token=' + encodeURIComponent(JSON.stringify({ access_token: 'no-dots' })),
    '',
    null,
  ];
  for (const c of cases) assert.equal(sessionUserId(c), kit.sessionUserId(c), `same answer for ${String(c).slice(0, 40)}`);
  assert.equal(sessionUserId(cookieFor('user-42')), 'user-42');
  assert.equal(sessionUserId(cases[1]), 'user-7');
});

test('learnerId: dev on localhost (the mock kit user), else the cookie subject, else null', () => {
  assert.equal(learnerId('', 'localhost'), 'dev');
  assert.equal(learnerId(cookieFor('u9'), '127.0.0.1'), 'dev');
  assert.equal(learnerId(cookieFor('u9'), 'wordforge.travelschooling.com'), 'u9');
  assert.equal(learnerId('', 'wordforge.travelschooling.com'), null);
  assert.equal(progressKey('u9'), 'wordforge:progress:u9');
  assert.equal(LEGACY_KEY, 'wordforge:progress');
});

test('two learners on one browser never see each other\'s counts', () => {
  const store = fullStorage();
  const a = createProgressSaver(() => store, progressKey('learner-a'));
  const b = createProgressSaver(() => store, progressKey('learner-b'));
  a.save({ storiesUnlocked: 2, correctTotal: 7 });
  b.save({ storiesUnlocked: 0, correctTotal: 1 });
  assert.deepEqual(loadLearnerProgress(() => store, 'learner-a', 18), { storiesUnlocked: 2, correctTotal: 7 });
  assert.deepEqual(loadLearnerProgress(() => store, 'learner-b', 18), { storiesUnlocked: 0, correctTotal: 1 });
  assert.deepEqual(loadLearnerProgress(() => store, 'learner-c', 18), { storiesUnlocked: 0, correctTotal: 0 });
});

test('the legacy unscoped record is claimed once, by the first learner, and absent for the second', () => {
  const store = fullStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 1, correctTotal: 5 }) });
  assert.deepEqual(loadLearnerProgress(() => store, 'first', 18), { storiesUnlocked: 1, correctTotal: 5 });
  assert.equal(store.data.has(LEGACY_KEY), false, 'the legacy key is removed');
  assert.deepEqual(JSON.parse(store.data.get('wordforge:progress:first')), { storiesUnlocked: 1, correctTotal: 5 });
  assert.deepEqual(loadLearnerProgress(() => store, 'second', 18), { storiesUnlocked: 0, correctTotal: 0 });
  assert.deepEqual(loadLearnerProgress(() => store, 'first', 18), { storiesUnlocked: 1, correctTotal: 5 }, 'the first learner keeps it');
});

test('a legacy record merges into an existing scoped one field-wise (max), sanitised as before', () => {
  const store = fullStorage({
    'wordforge:progress:u1': JSON.stringify({ storiesUnlocked: 2, correctTotal: 6 }),
    [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 99, correctTotal: 4 }),
  });
  assert.deepEqual(loadLearnerProgress(() => store, 'u1', 18), { storiesUnlocked: 18, correctTotal: 6 });
  assert.equal(store.data.has(LEGACY_KEY), false);
});

test('the legacy record stays until the scoped write succeeds', () => {
  const store = fullStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 1, correctTotal: 3 }) });
  store.failWrites = true;
  assert.deepEqual(loadLearnerProgress(() => store, 'u1', 18), { storiesUnlocked: 1, correctTotal: 3 }, 'this page still uses it');
  assert.equal(store.data.has(LEGACY_KEY), true, 'not removed while the scoped copy could not be written');
});

test('no learner id: nothing is read or written (memory only); unreadable storage starts from zero', () => {
  const store = fullStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 1, correctTotal: 3 }) });
  assert.deepEqual(loadLearnerProgress(() => store, null, 18), { storiesUnlocked: 0, correctTotal: 0 });
  assert.equal(store.data.has(LEGACY_KEY), true, 'the legacy record is left for a signed-in learner');
  const saver = createProgressSaver(() => store, null);
  assert.equal(saver.save({ storiesUnlocked: 1, correctTotal: 4 }), true);
  assert.equal(saver.unsaved(), false);
  assert.equal(store.data.size, 1);
  assert.deepEqual(loadLearnerProgress(() => { throw new Error('SecurityError'); }, 'u1', 18), { storiesUnlocked: 0, correctTotal: 0 });
});
