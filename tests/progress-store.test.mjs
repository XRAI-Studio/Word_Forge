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

const { learnerId, loadLearnerProgress, progressKey, sessionUserId, LEGACY_KEY, CLAIM_KEY } = globalThis.WF_PROGRESS;
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

test('a failed claim imports nothing, and no other learner can claim it afterwards (WF-001)', () => {
  const store = fullStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 1, correctTotal: 3 }) });
  store.failWrites = true;
  assert.deepEqual(loadLearnerProgress(() => store, 'u1', 18), { storiesUnlocked: 0, correctTotal: 0 }, 'nothing imported without a durable claim');
  assert.equal(store.data.has(LEGACY_KEY), true);
  // The marker write succeeded but the scoped copy failed: the claim is u1's.
  store.failWrites = false;
  store.data.set(CLAIM_KEY, 'u1');
  assert.deepEqual(loadLearnerProgress(() => store, 'u2', 18), { storiesUnlocked: 0, correctTotal: 0 }, 'another learner cannot take it');
  assert.equal(store.data.has(LEGACY_KEY), true);
  assert.deepEqual(loadLearnerProgress(() => store, 'u1', 18), { storiesUnlocked: 1, correctTotal: 3 }, 'the owner finishes the claim');
  assert.equal(store.data.get(CLAIM_KEY), 'done:u1');
  assert.equal(store.data.has(LEGACY_KEY), false);
});

test('a legacy key recreated by an old page after the claim is removed unread, for anyone (WF-001)', () => {
  const store = fullStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 1, correctTotal: 3 }) });
  loadLearnerProgress(() => store, 'first', 18);
  store.data.set(LEGACY_KEY, JSON.stringify({ storiesUnlocked: 2, correctTotal: 9 })); // an old tab's saveProgress
  assert.deepEqual(loadLearnerProgress(() => store, 'second', 18), { storiesUnlocked: 0, correctTotal: 0 });
  assert.equal(store.data.has(LEGACY_KEY), false);
  store.data.set(LEGACY_KEY, JSON.stringify({ storiesUnlocked: 2, correctTotal: 9 }));
  assert.deepEqual(loadLearnerProgress(() => store, 'first', 18), { storiesUnlocked: 1, correctTotal: 3 }, 'not even the owner re-imports');
});

test('no learner id: nothing is read or written (memory only); unreadable storage starts from zero', () => {
  const store = fullStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 1, correctTotal: 3 }) });
  assert.deepEqual(loadLearnerProgress(() => store, null, 18), { storiesUnlocked: 0, correctTotal: 0 });
  assert.equal(store.data.has(LEGACY_KEY), true, 'the legacy record is left for a signed-in learner');
  const saver = createProgressSaver(() => store, null);
  assert.equal(saver.save({ storiesUnlocked: 0, correctTotal: 0 }), true, 'nothing to keep yet');
  assert.equal(saver.unsaved(), false);
  assert.equal(saver.save({ storiesUnlocked: 1, correctTotal: 4 }), false, 'progress held only in memory is unsaved (WF-002)');
  assert.equal(saver.unsaved(), true, 'so the leave guard warns');
  assert.equal(store.data.size, 1);
  assert.deepEqual(loadLearnerProgress(() => { throw new Error('SecurityError'); }, 'u1', 18), { storiesUnlocked: 0, correctTotal: 0 });
});

// ---- cross-device sync, Plan 3: storage entries per learner (CDS3-001/009/012/013, WF-CDS3-002/003) ----

const S = globalThis.WF_PROGRESS;

/** A Storage-like map with enumeration; `failKey(k)` makes setItem throw for matching keys. */
function syncStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    failKey: () => false,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { if (this.failKey(k)) throw new Error('QuotaExceededError'); data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
  };
}
const entry = (store, k) => JSON.parse(store.data.get(k));

test('the sync algebra in progress-store.js agrees with kit.js on random states', () => {
  const rng = (s) => { let x = s >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
  for (let seed = 1; seed <= 500; seed++) {
    const r = rng(seed);
    const mk = () => {
      const o = { v: 2, correct: {} };
      for (const k of ['legacy', 's.a', 's.b', 'constructor', '__proto__']) if (r() < 0.5) Object.defineProperty(o.correct, k, { value: Math.floor(r() * 9) - 1, enumerable: true });
      return r() < 0.1 ? { correctTotal: Math.floor(r() * 9), storiesUnlocked: 1 } : o;
    };
    const a = mk(), b = mk();
    assert.deepEqual(S.syncState(a), kit.syncState(a));
    assert.deepEqual(S.mergeSync(a, b), kit.mergeSync(a, b));
    assert.equal(JSON.stringify(S.mergeSync(a, b)), JSON.stringify(kit.mergeSync(a, b)));
    assert.equal(S.syncTotal(a), kit.syncTotal(a));
  }
});

test('loadSync writes the legacy baseline entry when it is missing, even at 0, and merges it in', () => {
  const store = syncStorage();
  assert.deepEqual(S.loadSync(() => store, 'u1', 7), { v: 2, correct: { legacy: 7 } });
  assert.deepEqual(entry(store, 'wordforge:sync:u1:legacy'), { v: 2, correct: { legacy: 7 } });
  const empty = syncStorage();
  assert.deepEqual(S.loadSync(() => empty, 'u1', 0), { v: 2, correct: {} });
  assert.deepEqual(entry(empty, 'wordforge:sync:u1:legacy'), { v: 2, correct: {} }, 'the import is marked done');
});

test('the legacy entry is the max of its value and the claimed aggregate: re-importing never counts twice (WF-CDS3-003)', () => {
  const store = syncStorage();
  for (let i = 0; i < 3; i++) assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 9)), 9, `load ${i + 1}`);
  assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 4)), 9, 'a smaller aggregate never lowers it');
  assert.deepEqual(entry(store, 'wordforge:sync:u1:legacy'), { v: 2, correct: { legacy: 9 } });
  // The old record only grows when the unscoped legacy record is claimed into it (a max).
  assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 11)), 11);
  assert.deepEqual(entry(store, 'wordforge:sync:u1:legacy'), { v: 2, correct: { legacy: 11 } });
});

test('loadSync merges the legacy, known and every session entry of this learner only; unreadable entries are skipped', () => {
  const store = syncStorage({
    'wordforge:sync:u1:legacy': JSON.stringify({ v: 2, correct: { legacy: 4 } }),
    'wordforge:sync:u1:known': JSON.stringify({ v: 2, correct: { legacy: 4, 's.aaa': 1, 's.phone': 6 } }),
    'wordforge:sync:u1:aaa': JSON.stringify({ v: 2, correct: { 's.aaa': 2 } }),
    'wordforge:sync:u1:bbb': JSON.stringify({ v: 2, correct: { 's.bbb': 3 } }),
    'wordforge:sync:u1:ccc': '{not json',
    'wordforge:sync:u2:zzz': JSON.stringify({ v: 2, correct: { 's.zzz': 50 } }),
    'wordforge:progress:u1': JSON.stringify({ storiesUnlocked: 1, correctTotal: 4 }),
  });
  assert.deepEqual(S.loadSync(() => store, 'u1', 4), { v: 2, correct: { legacy: 4, 's.aaa': 2, 's.bbb': 3, 's.phone': 6 } });
  assert.deepEqual(S.loadSync(() => store, 'u2', 0), { v: 2, correct: { 's.zzz': 50 } });
});

test('loadSync with no learner reads and writes nothing; unreadable storage starts from the legacy total in memory', () => {
  const store = syncStorage();
  assert.deepEqual(S.loadSync(() => store, null, 3), { v: 2, correct: {} });
  assert.equal(store.data.size, 0);
  assert.deepEqual(S.loadSync(() => { throw new Error('SecurityError'); }, 'u1', 3), { v: 2, correct: { legacy: 3 } });
});

test("saveSync writes only this session's key, holding only this session's bucket, and reports a failed write", () => {
  const store = syncStorage();
  assert.equal(S.saveSync(() => store, 'u1', 'abc', { v: 2, correct: { legacy: 9, 's.abc': 1, 's.phone': 4 } }), true);
  assert.deepEqual([...store.data.keys()], ['wordforge:sync:u1:abc']);
  assert.deepEqual(entry(store, 'wordforge:sync:u1:abc'), { v: 2, correct: { 's.abc': 1 } });
  store.failKey = () => true;
  assert.equal(S.saveSync(() => store, 'u1', 'abc', { v: 2, correct: { 's.abc': 2 } }), false);
  assert.deepEqual(entry(store, 'wordforge:sync:u1:abc'), { v: 2, correct: { 's.abc': 1 } });
  assert.equal(S.saveSync(() => { throw new Error('SecurityError'); }, 'u1', 'abc', { v: 2, correct: {} }), false);
  assert.equal(S.saveSync(() => store, null, 'abc', { v: 2, correct: {} }), true, 'nothing to keep yet');
  assert.equal(S.saveSync(() => store, null, 'abc', { v: 2, correct: { 's.abc': 1 } }), false, 'memory only is unsaved');
});

test('two tabs closed before the kit starts: both answers survive a reopen (separate session entries)', () => {
  const store = syncStorage();
  const base = S.loadSync(() => store, 'u1', 10);
  assert.ok(S.saveSync(() => store, 'u1', 'A', S.mergeSync(base, { v: 2, correct: { 's.A': 1 } })));
  assert.ok(S.saveSync(() => store, 'u1', 'B', S.mergeSync(base, { v: 2, correct: { 's.B': 1 } })));
  assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 10)), S.syncTotal(base) + 2);
});

test('repeated reloads with the (frozen) aggregate never grow the total', () => {
  const store = syncStorage();
  let st = S.loadSync(() => store, 'u1', 10);
  st = S.mergeSync(st, { v: 2, correct: { 's.A': 2 } });
  S.saveSync(() => store, 'u1', 'A', st);
  for (let i = 0; i < 3; i++) assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 10)), 12);
});

test('a session: addCorrect counts in its own immutable bucket, writes its entry synchronously, and refreshes :known', () => {
  const store = syncStorage();
  const a = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'k3', legacyTotal: 5 });
  assert.equal(a.bucket, 's.k3');
  assert.equal(S.syncTotal(a.getState()), 5);
  assert.equal(store.data.has('wordforge:sync:u1:k3'), false, 'nothing written before the first answer');
  a.addCorrect();
  a.addCorrect();
  assert.deepEqual(entry(store, 'wordforge:sync:u1:k3'), { v: 2, correct: { 's.k3': 2 } });
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), { v: 2, correct: { legacy: 5, 's.k3': 2 } });
  assert.equal(a.unsaved(), false);
  a.setState({ v: 2, correct: { 's.phone': 4, 's.k3': 1 } });
  assert.deepEqual(a.getState(), { v: 2, correct: { legacy: 5, 's.k3': 2, 's.phone': 4 } }, 'adopting only ever merges');
  assert.deepEqual(entry(store, 'wordforge:sync:u1:k3'), { v: 2, correct: { 's.k3': 2 } }, 'the session entry keeps its own bucket only');
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), a.getState(), 'the adopted work is kept in :known');
  assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 5)), 11, 'an offline reload shows it all');
});

test('addCorrect marks progress unsaved when the session entry cannot be written, even though other writes succeed (CDS3-012)', () => {
  const store = syncStorage();
  store.failKey = (k) => k === 'wordforge:sync:u1:k3';
  const aggregate = createProgressSaver(() => store, progressKey('u1'));
  const a = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'k3', legacyTotal: 0 });
  a.addCorrect();
  assert.equal(aggregate.save({ storiesUnlocked: 0, correctTotal: 1 }), true, 'another key can be written');
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), { v: 2, correct: { 's.k3': 1 } }, 'the shared :known entry was written');
  assert.equal(a.unsaved(), true, 'the session entry was not, so progress is unsaved');
  assert.equal(a.retry(), false);
  assert.equal(a.unsaved(), true);
  store.failKey = () => false;
  assert.equal(a.retry(), true, 'a later successful write clears it');
  assert.equal(a.unsaved(), false);
  assert.deepEqual(entry(store, 'wordforge:sync:u1:k3'), { v: 2, correct: { 's.k3': 1 } });
});

test('acknowledged merges the server copy in and refreshes :known; it never removes or rewrites another entry', () => {
  const store = syncStorage({
    'wordforge:sync:u1:legacy': JSON.stringify({ v: 2, correct: { legacy: 3 } }),
    'wordforge:sync:u1:a1': JSON.stringify({ v: 2, correct: { 's.a1': 2 } }),
  });
  const m = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'm', legacyTotal: 0 });
  const before = new Map(store.data);
  m.acknowledged({ v: 2, correct: { legacy: 3, 's.a1': 2, 's.phone': 1 } });
  assert.deepEqual(m.getState(), { v: 2, correct: { legacy: 3, 's.a1': 2, 's.phone': 1 } });
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), m.getState());
  for (const [k, v] of before) assert.equal(store.data.get(k), v, `${k} untouched`);
  assert.equal(store.data.has('wordforge:sync:u1:m'), false, 'no own entry without an answer');
});

test('a lost race on :known costs nothing permanent: session entries still hold every answer', () => {
  const store = syncStorage();
  const a = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'a', legacyTotal: 1 });
  const b = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'b', legacyTotal: 1 });
  a.addCorrect();
  a.addCorrect();
  b.addCorrect();
  // Two writes in the same instant: one lands on a stale read and drops a's answers from :known.
  store.data.set('wordforge:sync:u1:known', JSON.stringify({ v: 2, correct: { legacy: 1, 's.b': 1 } }));
  assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', 1)), 4);
});

// ---- Codex WF-CDS3-002 / WF-CDS3-003 regressions ----

test('WF-CDS3-002: new work in session A while session B does everything it can; both close: A\'s answers survive a reload', () => {
  const store = syncStorage({ 'wordforge:sync:u1:legacy': JSON.stringify({ v: 2, correct: { legacy: 1 } }) });
  const aKey = 'wordforge:sync:u1:a';
  let inB = false;
  let fired = false;
  let reads = 0;
  // A writes right after B's second read of A's entry (B's "unchanged on re-read" check)
  // and before B's next step: the window Codex found between the re-read and a removal.
  const getItem = store.getItem.bind(store);
  store.getItem = (k) => {
    const v = getItem(k);
    if (inB && k === aKey && !fired && ++reads === 2) { fired = true; inB = false; a.addCorrect(); inB = true; }
    return v;
  };
  const a = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'a', legacyTotal: 0 });
  const b = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'b', legacyTotal: 0 });
  a.addCorrect();
  const seen = a.getState();
  inB = true;
  b.setState(seen);
  b.addCorrect();
  b.acknowledged(S.mergeSync(seen, b.getState()));
  b.retry();
  b.acknowledged(S.mergeSync(seen, b.getState()));
  inB = false;
  if (!fired) a.addCorrect(); // B never read A's entry: A's new work happens now instead
  const total = S.syncTotal(S.loadSync(() => store, 'u1', 0));
  assert.equal(total, 1 + 2 + 1, 'legacy 1, A\'s 2 answers, B\'s 1 answer');
});

test('WF-CDS3-003: a failed claim, then a recovered session write, then a reload with the claim succeeding: total 10, and it stays 10', () => {
  const store = syncStorage({ [LEGACY_KEY]: JSON.stringify({ storiesUnlocked: 3, correctTotal: 9 }) });
  store.failKey = () => true; // the claim (and the :legacy entry) cannot be written
  const firstLegacy = loadLearnerProgress(() => store, 'u1', 18).correctTotal;
  assert.equal(firstLegacy, 0, 'nothing imported without a durable claim');
  const s1 = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 's1', legacyTotal: firstLegacy });
  store.failKey = () => false; // storage recovers
  s1.addCorrect();
  assert.equal(s1.unsaved(), false, 'the session entry was written');
  for (let i = 0; i < 3; i++) {
    const legacy = loadLearnerProgress(() => store, 'u1', 18).correctTotal;
    assert.equal(S.syncTotal(S.loadSync(() => store, 'u1', legacy)), 10, `reload ${i + 1}`);
  }
});

test('WF-REVIEW-001: a stale tab answering never erases arrivals another tab kept only in :known (offline reload, no kit)', () => {
  const store = syncStorage();
  const a = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'a', legacyTotal: 0 });
  const b = S.createSyncSession({ getStorage: () => store, learner: 'u1', session: 'b', legacyTotal: 0 }); // never sees the phone
  a.setState({ v: 2, correct: { 's.phone': 3 } }); // the phone's answers, adopted by A only
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), { v: 2, correct: { 's.phone': 3 } });
  b.addCorrect(); // B answers offline and writes
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), { v: 2, correct: { 's.b': 1, 's.phone': 3 } }, ':known is read, merged, written');
  const reloaded = S.loadSync(() => store, 'u1', 0);
  assert.equal(S.syncTotal(reloaded), 4, "the phone's 3 answers and B's 1");
  assert.equal(Math.floor(S.syncTotal(reloaded) / 3), 1, 'the story they unlocked stays unlocked');
});

test('saveKnown with an unreadable :known entry still writes the state', () => {
  const store = syncStorage({ 'wordforge:sync:u1:known': '{broken' });
  assert.equal(S.saveKnown(() => store, 'u1', { v: 2, correct: { 's.a': 1 } }), true);
  assert.deepEqual(entry(store, 'wordforge:sync:u1:known'), { v: 2, correct: { 's.a': 1 } });
});
