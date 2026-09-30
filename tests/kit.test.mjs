import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChangeRestart, award, createPublisher, flushAwards, mergeProgress, progressSummary, progressSync, RESTART_LOSS_TEXT, RESTART_STALLED_TEXT, RESTART_TEXT, initKit, isDevHost, mockKit, pendingAwardCount, sameAccount, sessionUserId, trackPending, GAME } from '../public/kit.js';

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256' })}.${b64({ sub, approved: true })}.sig`;
}
function cookieFor(sub) {
  return 'sb-abc-auth-token=' + encodeURIComponent(JSON.stringify({ access_token: jwt(sub), token_type: 'bearer' }));
}

test('GAME is the portal slug', () => {
  assert.equal(GAME, 'wordforge');
});

test('isDevHost recognises localhost and 127.0.0.1 only', () => {
  assert.equal(isDevHost('localhost'), true);
  assert.equal(isDevHost('127.0.0.1'), true);
  assert.equal(isDevHost('wordforge.travelschooling.com'), false);
});

test('initKit returns the mock on a dev host without touching TSKit', async () => {
  let inited = false;
  const win = {};
  const r = await initKit({ hostname: 'localhost', TSKit: { init: async () => { inited = true; return {}; } }, win });
  assert.equal(r.kind, 'ready');
  assert.equal(inited, false);
  await r.kit.award('word_forged', { word: 'aqueduct' });
  assert.deepEqual(win.__kitAwards, [{ event: 'word_forged', detail: { word: 'aqueduct' } }]);
});

test('initKit on the live host: unavailable without TSKit, redirecting without a user, ready with one', async () => {
  assert.deepEqual(await initKit({ hostname: 'wordforge.travelschooling.com', TSKit: undefined }), { kind: 'unavailable' });
  let game = null;
  const noUser = { init: async (o) => { game = o.game; return { user: null }; } };
  assert.deepEqual(await initKit({ hostname: 'wordforge.travelschooling.com', TSKit: noUser }), { kind: 'redirecting' });
  assert.equal(game, GAME);
  const kit = { user: { id: 'u1' }, award: async () => ({}) };
  const r = await initKit({ hostname: 'wordforge.travelschooling.com', TSKit: { init: async () => kit } });
  assert.equal(r.kind, 'ready');
  assert.equal(r.kit, kit);
});

test('mockKit records awards on the given window object', async () => {
  const win = {};
  const kit = mockKit(win);
  await kit.award('story_unlocked', { story: 1 });
  assert.equal(win.__kitAwards.length, 1);
  assert.equal(kit.user.id, 'dev');
});

test('sessionUserId reads the subject out of the session cookie, chunked or base64-prefixed too', () => {
  assert.equal(sessionUserId(cookieFor('user-42')), 'user-42');
  const payload = Buffer.from(JSON.stringify({ access_token: jwt('user-7') })).toString('base64url');
  const b64 = 'base64-' + payload;
  const cut = Math.floor(b64.length / 2);
  assert.equal(sessionUserId(`other=1; sb-abc-auth-token.1=${b64.slice(cut)}; sb-abc-auth-token.0=${b64.slice(0, cut)}`), 'user-7');
  assert.equal(sessionUserId(null), null);
  assert.equal(sessionUserId('theme=dark'), null);
  assert.equal(sessionUserId('sb-abc-auth-token=not-json'), null);
});

test('sameAccount: the mock kit always matches; a real kit matches only its own subject', () => {
  assert.equal(sameAccount({ mock: true, user: { id: 'dev' } }, ''), true);
  const kit = { user: { id: 'user-1' } };
  assert.equal(sameAccount(kit, cookieFor('user-1')), true);
  assert.equal(sameAccount(kit, cookieFor('user-2')), false);
  assert.equal(sameAccount(kit, ''), false);
});

test('award refuses to credit a kit whose learner is no longer the signed-in one, and reports it', async () => {
  const sent = [];
  const kit = { user: { id: 'user-1' }, award: async (e, d) => { sent.push([e, d]); return {}; } };
  let mismatches = 0;
  const opts = (cookie) => ({ cookie: () => cookie, onMismatch: () => { mismatches++; } });
  assert.equal(award(kit, 'word_forged', { word: 'x' }, opts(cookieFor('user-1'))), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [['word_forged', { word: 'x' }]]);
  assert.equal(award(kit, 'word_forged', { word: 'y' }, opts(cookieFor('user-2'))), false);
  assert.equal(award(kit, 'story_unlocked', { story: 1 }, opts('')), false);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(mismatches, 2);
});

const tick = () => new Promise((r) => setImmediate(r));

// The mock kit matches any cookie; pass one so award() does not read document.cookie.
const MOCK_OPTS = { cookie: () => '' };

test('flushAwards resolves at once when no award is in flight', async () => {
  assert.equal(pendingAwardCount(), 0);
  assert.equal(await flushAwards(10), true);
});

test('award tracks the call until it settles, and flushAwards waits for it', async () => {
  let answer;
  const kit = { mock: true, user: { id: 'dev' }, award: () => new Promise((r) => { answer = r; }) };
  assert.equal(award(kit, 'word_forged', { word: 'x' }, MOCK_OPTS), true);
  assert.equal(pendingAwardCount(), 1);
  const flushed = flushAwards(2000);
  setTimeout(() => answer({}), 20);
  assert.equal(await flushed, true);
  assert.equal(pendingAwardCount(), 0);
});

test('a failed award still settles and leaves the pending set', async () => {
  const kit = { mock: true, user: { id: 'dev' }, award: async () => { throw new Error('offline'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    award(kit, 'word_forged', { word: 'x' }, MOCK_OPTS);
    assert.equal(await flushAwards(2000), true);
    assert.equal(pendingAwardCount(), 0);
  } finally {
    console.warn = warn;
  }
});

test('flushAwards gives up after the timeout when an award hangs', async () => {
  let answer;
  const kit = { mock: true, user: { id: 'dev' }, award: () => new Promise((r) => { answer = r; }) };
  award(kit, 'story_unlocked', { story: 1 }, MOCK_OPTS);
  const started = Date.now();
  assert.equal(await flushAwards(40), false);
  assert.ok(Date.now() - started >= 30, 'waited for the timeout');
  assert.equal(pendingAwardCount(), 1);
  answer({});
  assert.equal(await flushAwards(2000), true);
  assert.equal(pendingAwardCount(), 0);
});

test('a refused award (account changed) is not tracked', async () => {
  const kit = { user: { id: 'user-1' }, award: async () => ({}) };
  assert.equal(award(kit, 'word_forged', {}, { cookie: () => cookieFor('user-2'), onMismatch: () => {} }), false);
  assert.equal(pendingAwardCount(), 0);
});

test('flushAwards also waits for an award that starts during the wait', async () => {
  const answers = [];
  const kit = { mock: true, user: { id: 'dev' }, award: () => new Promise((r) => { answers.push(r); }) };
  award(kit, 'word_forged', { word: 'a' }, MOCK_OPTS);
  const flushed = flushAwards(2000);
  await tick(); // award() calls the kit on the next microtask
  let done = false;
  flushed.then(() => { done = true; });
  // The first award settles, and in the same turn a new one starts (a correct answer in flight).
  answers[0]({});
  award(kit, 'story_unlocked', { story: 1 }, MOCK_OPTS);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false, 'still waiting for the second award');
  assert.equal(pendingAwardCount(), 1);
  answers[1]({});
  assert.equal(await flushed, true);
  assert.equal(pendingAwardCount(), 0);
});

test('successive awards share one deadline, not one each', async () => {
  const answers = [];
  const kit = { mock: true, user: { id: 'dev' }, award: () => new Promise((r) => { answers.push(r); }) };
  award(kit, 'word_forged', { word: 'a' }, MOCK_OPTS);
  const started = Date.now();
  const flushed = flushAwards(80);
  setTimeout(() => { award(kit, 'word_forged', { word: 'b' }, MOCK_OPTS); answers[0]({}); }, 50);
  assert.equal(await flushed, false);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 70 && elapsed < 125, `gave up at the shared deadline (${elapsed} ms)`);
  answers[1]({});
  assert.equal(await flushAwards(2000), true);
  assert.equal(pendingAwardCount(), 0);
});

function restartHarness({ unsaved = false } = {}) {
  const log = { reloads: 0, banners: [], allow: [], timers: [] };
  const restart = accountChangeRestart({
    reload: () => { log.reloads++; }, // a cancelled reload: the page stays
    showBanner: (text, action) => { log.banners.push({ text, action }); },
    allowUnload: (on) => { log.allow.push(on); return unsaved; },
    schedule: (fn) => { log.timers.push(fn); },
  });
  return { log, restart };
}

test('account change: releases the leave prompt, says the word is lost, refuses awards and reloads once', () => {
  const { log, restart } = restartHarness({ unsaved: true });
  assert.equal(restart.isRestarting(), false);
  restart.run();
  restart.run(); // visibilitychange and focus can both fire
  assert.equal(restart.isRestarting(), true);
  assert.equal(log.reloads, 1);
  assert.deepEqual(log.allow, [true]);
  assert.equal(log.banners[0].text, RESTART_LOSS_TEXT);
  assert.equal(log.banners[0].action, null);
});

test('account change with nothing unsaved just reloads', () => {
  const { log, restart } = restartHarness();
  restart.run();
  assert.equal(log.banners[0].text, RESTART_TEXT);
});

test('account change: a cancelled reload restores the prompt and offers Reload, which retries', () => {
  const { log, restart } = restartHarness({ unsaved: true });
  restart.run();
  log.timers.shift()(); // still here after the stall delay
  assert.equal(restart.isRestarting(), true, 'awards still refused to the old account');
  assert.deepEqual(log.allow, [true, false], 'leave prompt protection restored');
  const stalled = log.banners.at(-1);
  assert.equal(stalled.text, RESTART_STALLED_TEXT);
  assert.equal(typeof stalled.action, 'function');
  stalled.action(); // the learner presses Reload
  assert.equal(log.reloads, 2);
  assert.deepEqual(log.allow, [true, false, true]);
  assert.equal(log.banners.at(-1).text, RESTART_LOSS_TEXT);
  assert.equal(log.timers.length, 1, 'watching the retry too');
});

test('account change: a stale stall timer from an earlier attempt is ignored', () => {
  const { log, restart } = restartHarness();
  restart.run();
  const firstTimer = log.timers.shift();
  firstTimer(); // stalled
  log.banners.at(-1).action(); // retry: reloading again
  const banners = log.banners.length;
  firstTimer(); // a late duplicate of the first attempt's timer
  assert.equal(log.banners.length, banners, 'no stalled banner over the retry');
  assert.equal(log.allow.at(-1), true, 'prompt still released for the retry');
});

test('leaving during a slow kit start-up waits for it under the same deadline', async () => {
  let finishInit;
  const TSKit = { init: () => new Promise((r) => { finishInit = r; }) };
  const starting = initKit({ hostname: 'wordforge.travelschooling.com', TSKit });
  assert.equal(pendingAwardCount(), 1, 'the start-up is tracked');
  const flushed = flushAwards(2000);
  let done = false;
  flushed.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false, 'waiting for the start-up');
  finishInit({ user: { id: 'u1' }, award: async () => ({}) });
  assert.equal((await starting).kind, 'ready');
  assert.equal(await flushed, true);
  assert.equal(pendingAwardCount(), 0);
});

test('a start-up that hangs is bounded by the deadline, and a failing one settles', async () => {
  let finishInit;
  const hang = { init: () => new Promise((r) => { finishInit = r; }) };
  const starting = initKit({ hostname: 'wordforge.travelschooling.com', TSKit: hang });
  assert.equal(await flushAwards(40), false, 'gave up at the deadline');
  finishInit({ user: null });
  assert.equal((await starting).kind, 'redirecting');
  const failing = initKit({ hostname: 'wordforge.travelschooling.com', TSKit: { init: async () => { throw new Error('down'); } } });
  await assert.rejects(failing);
  assert.equal(await flushAwards(2000), true);
  assert.equal(pendingAwardCount(), 0);
});

// ---- launcher tile (work order 2026-09-30-tile-summaries-and-copy) ----

/**
 * The portal side of `save_progress` / `game_progress`: a save whose rev is lower than the
 * stored state's rev is dropped and answers false (0007_progress_revision_guard.sql).
 */
function fakePortal() {
  return {
    row: null,
    offline: false,
    saveCalls: 0,
    async select() {
      if (this.offline) throw new Error('network');
      return this.row ? [structuredClone(this.row)] : [];
    },
    async saveProgress({ p_state, p_summary, p_rev }) {
      this.saveCalls++;
      if (this.offline) throw new Error('network');
      const stored = this.row && typeof this.row.state.rev === 'number' ? this.row.state.rev : 0;
      if (this.row && p_rev < stored) return false;
      this.row = { state: structuredClone(p_state), summary: structuredClone(p_summary) };
      return true;
    },
  };
}

/**
 * A port of ts-kit.js's load / save / flush (public/kit/v1/ts-kit.js lines 74-100) with a
 * shorter debounce: save() replaces the pending snapshot and cancels the earlier timer
 * without settling the earlier call's promise; flush settles when the server answered
 * (dropped or not) and marks the cache dirty on failure; load() prefers a dirty local cache,
 * then the server, then the local cache.
 */
function fakeKit(portal, storage = new Map(), { debounceMs = 5, userId = 'u1' } = {}) {
  const cacheKey = `tskit:wordforge:${userId}`;
  const ls = (val) => {
    if (val === undefined) return storage.has(cacheKey) ? structuredClone(storage.get(cacheKey)) : null;
    storage.set(cacheKey, structuredClone(val));
  };
  let saveTimer = null;
  let pending = null;
  const calls = { save: 0 };
  function flush() {
    if (!pending) return Promise.resolve();
    const p = pending; pending = null;
    const rev = p.state && typeof p.state.rev === 'number' ? p.state.rev : 0;
    return portal.saveProgress({ p_state: p.state, p_summary: p.summary, p_rev: rev })
      .then(() => { ls({ state: p.state, summary: p.summary }); })
      .catch(() => { ls({ state: p.state, summary: p.summary, dirty: true }); });
  }
  return {
    user: { id: userId },
    calls,
    load() {
      return portal.select().then((rows) => {
        const server = rows && rows[0]; const local = ls();
        if (local && local.dirty) return local.state;
        if (server) { ls({ state: server.state, summary: server.summary }); return server.state; }
        return local ? local.state : {};
      }).catch(() => { const local = ls(); return local ? local.state : {}; });
    },
    save(state, summary) {
      calls.save++;
      pending = { state, summary: summary || {} };
      ls({ state, summary: summary || {}, dirty: true });
      if (saveTimer) clearTimeout(saveTimer);
      return new Promise((resolve) => { saveTimer = setTimeout(() => { flush().then(resolve, resolve); }, debounceMs); });
    },
    award: async () => ({}),
  };
}

/** A private pending-work set, so these tests do not touch the module's own. */
const localTrack = () => {
  const set = new Set();
  const track = (p) => {
    const t = Promise.resolve(p).then(() => undefined, () => undefined).finally(() => set.delete(t));
    set.add(t);
    return p;
  };
  return { set, track };
};
const idle = async (set) => { while (set.size) await Promise.allSettled([...set]); };

/** The game's window.__wfProgress, over plain counters. */
function gameHook(start = { storiesUnlocked: 0, correctTotal: 0 }, learner = 'u1') {
  let p = { ...start };
  const sets = [];
  return {
    learner,
    storyCount: 18,
    get: () => ({ ...p }),
    set: (next) => { p = { ...next }; sets.push({ ...next }); },
    answer() { p.correctTotal++; if (p.correctTotal % 3 === 0 && p.storiesUnlocked < 18) p.storiesUnlocked++; return { ...p }; },
    sets,
  };
}

test('progressSummary: words forged and stories of the total, singular for one word', () => {
  assert.deepEqual(progressSummary({ storiesUnlocked: 0, correctTotal: 1 }, 18), { headline: '1 word forged · 0 of 18 stories', percent: 0 });
  assert.deepEqual(progressSummary({ storiesUnlocked: 1, correctTotal: 3 }, 18), { headline: '3 words forged · 1 of 18 stories', percent: 6 });
  assert.deepEqual(progressSummary({ storiesUnlocked: 0, correctTotal: 0 }, 18), { headline: '0 words forged · 0 of 18 stories', percent: 0 });
  assert.deepEqual(progressSummary({ storiesUnlocked: 18, correctTotal: 60 }, 18), { headline: '60 words forged · 18 of 18 stories', percent: 100 });
});

test('mergeProgress: field-wise max; non-numeric server values count as 0; stories capped', () => {
  assert.deepEqual(mergeProgress({ storiesUnlocked: 1, correctTotal: 4 }, { storiesUnlocked: 2, correctTotal: 7 }), { storiesUnlocked: 2, correctTotal: 7 });
  assert.deepEqual(mergeProgress({ storiesUnlocked: 2, correctTotal: 7 }, { storiesUnlocked: 1, correctTotal: 4 }), { storiesUnlocked: 2, correctTotal: 7 });
  assert.deepEqual(mergeProgress({ storiesUnlocked: 1, correctTotal: 4 }, {}), { storiesUnlocked: 1, correctTotal: 4 });
  assert.deepEqual(mergeProgress({ storiesUnlocked: 1, correctTotal: 4 }, { storiesUnlocked: '9', correctTotal: 'lots', rev: 99 }), { storiesUnlocked: 1, correctTotal: 4 });
  assert.deepEqual(mergeProgress({ storiesUnlocked: 0, correctTotal: 0 }, { storiesUnlocked: 40, correctTotal: 2.7 }, 18), { storiesUnlocked: 18, correctTotal: 2 });
  assert.deepEqual(mergeProgress(null, null), { storiesUnlocked: 0, correctTotal: 0 });
});

test('createPublisher never calls kit.save while an earlier call is unsettled; rapid requests end with the newest snapshot saved', async () => {
  const portal = fakePortal();
  const kit = fakeKit(portal);
  const { set, track } = localTrack();
  let inFlight = 0;
  let maxInFlight = 0;
  const pub = createPublisher(async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await kit.save({ rev: n, n }, { headline: `n=${n}` });
    } finally {
      inFlight--;
    }
  }, { track });
  const done = [];
  for (let n = 1; n <= 6; n++) {
    done.push(pub.request(n));
    assert.ok(set.size <= 1, 'only the run is tracked');
    await new Promise((r) => setTimeout(r, 1));
  }
  await Promise.all(done);
  await idle(set);
  assert.equal(maxInFlight, 1);
  assert.equal(portal.row.state.n, 6, 'the newest snapshot reached the server');
  assert.equal(set.size, 0, 'nothing left pending');
  assert.equal(pub.busy(), false);
  assert.ok(kit.calls.save < 6, 'requests during a run were coalesced');
});

test('createPublisher: a failing publish still settles the run and clears the pending set', async () => {
  const { set, track } = localTrack();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const pub = createPublisher(async () => { throw new Error('boom'); }, { track });
    await pub.request(1);
    await idle(set);
    assert.equal(set.size, 0);
    assert.equal(pub.busy(), false);
  } finally {
    console.warn = warn;
  }
});

test('progressSync start-up: existing local progress reaches the tile with no play, rev = correctTotal', async () => {
  const portal = fakePortal();
  const kit = fakeKit(portal);
  const hook = gameHook({ storiesUnlocked: 1, correctTotal: 4 });
  const { set, track } = localTrack();
  const sync = progressSync(kit, hook, { cookie: () => cookieFor('u1'), track });
  await sync.start();
  await idle(set);
  assert.deepEqual(portal.row.state, { rev: 4, storiesUnlocked: 1, correctTotal: 4 });
  assert.deepEqual(portal.row.summary, { headline: '4 words forged · 1 of 18 stories', percent: 6 });
  assert.equal(portal.saveCalls, 1, 'published once');
});

test('progressSync start-up: the server copy only raises the counts; a device with fewer answers never lowers it', async () => {
  const portal = fakePortal();
  portal.row = { state: { rev: 9, storiesUnlocked: 3, correctTotal: 9 }, summary: {} };
  const kit = fakeKit(portal);
  const hook = gameHook({ storiesUnlocked: 1, correctTotal: 4 });
  const { set, track } = localTrack();
  const sync = progressSync(kit, hook, { cookie: () => cookieFor('u1'), track });
  await sync.start();
  await idle(set);
  assert.deepEqual(hook.get(), { storiesUnlocked: 3, correctTotal: 9 }, 'merged into the game');
  assert.deepEqual(hook.sets.at(-1), { storiesUnlocked: 3, correctTotal: 9 }, 'stored through the hook');
  assert.equal(portal.row.state.correctTotal, 9);
  // A stale snapshot from before the merge (a lower rev) is dropped by the server.
  sync.publish({ storiesUnlocked: 1, correctTotal: 5 });
  await idle(set);
  assert.deepEqual(portal.row.state, { rev: 9, storiesUnlocked: 3, correctTotal: 9 });
  assert.equal(portal.row.summary.headline, '9 words forged · 3 of 18 stories');
});

test('progressSync: answers made while the first load is out count, and are published once after it', async () => {
  const portal = fakePortal();
  portal.row = { state: { rev: 2, storiesUnlocked: 0, correctTotal: 2 }, summary: {} };
  const kit = fakeKit(portal);
  let release;
  const gate = new Promise((r) => { release = r; });
  const load = kit.load.bind(kit);
  kit.load = () => gate.then(load);
  const hook = gameHook();
  const { set, track } = localTrack();
  const sync = progressSync(kit, hook, { cookie: () => cookieFor('u1'), track });
  const started = track(sync.start()); // index.html tracks the whole start-up
  sync.publish(hook.answer()); // before the start-up publish: the start-up reads the counts itself
  sync.publish(hook.answer());
  sync.publish(hook.answer());
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(portal.saveCalls, 0, 'nothing published before the first load resolved');
  assert.equal(set.size, 1, 'the start-up is pending work');
  release();
  await started;
  await idle(set);
  assert.deepEqual(hook.get(), { storiesUnlocked: 1, correctTotal: 3 }, 'max(3 in memory, 2 on the server)');
  assert.equal(portal.saveCalls, 1);
  assert.equal(portal.row.summary.headline, '3 words forged · 1 of 18 stories');
  // After the start-up publish, each save goes straight through the publisher.
  sync.publish(hook.answer());
  await idle(set);
  assert.equal(portal.row.summary.headline, '4 words forged · 1 of 18 stories');
});

test('progressSync: a load failure publishes the in-memory counts only; nothing to publish for a new learner', async () => {
  const portal = fakePortal();
  const kit = fakeKit(portal);
  kit.load = async () => { throw new Error('network'); };
  const { set, track } = localTrack();
  const sync = progressSync(kit, gameHook({ storiesUnlocked: 0, correctTotal: 2 }), { cookie: () => cookieFor('u1'), track });
  await sync.start();
  await idle(set);
  assert.equal(portal.row.summary.headline, '2 words forged · 0 of 18 stories');

  const empty = fakePortal();
  const fresh = progressSync(fakeKit(empty), gameHook(), { cookie: () => cookieFor('u1'), track });
  await fresh.start();
  await idle(set);
  assert.equal(empty.saveCalls, 0, 'the tile stays "Not started" until the first answer');
});

test('progressSync refuses to save for a learner who is no longer signed in, or when the page belongs to another learner', async () => {
  const portal = fakePortal();
  const kit = fakeKit(portal);
  const { set, track } = localTrack();
  let mismatches = 0;
  let cookie = cookieFor('u1');
  const hook = gameHook({ storiesUnlocked: 0, correctTotal: 1 });
  const sync = progressSync(kit, hook, { cookie: () => cookie, onMismatch: () => { mismatches++; }, track });
  await sync.start();
  await idle(set);
  assert.equal(portal.row.summary.headline, '1 word forged · 0 of 18 stories');
  cookie = cookieFor('u2');
  sync.publish(hook.answer());
  await idle(set);
  assert.equal(mismatches, 1);
  assert.equal(portal.row.summary.headline, '1 word forged · 0 of 18 stories', 'nothing saved for the previous learner');

  // The page loaded u2's local progress but the kit started as u1: nothing is merged or saved.
  const other = fakePortal();
  const wrong = progressSync(fakeKit(other), gameHook({ storiesUnlocked: 1, correctTotal: 5 }, 'u2'), { cookie: () => cookieFor('u1'), onMismatch: () => { mismatches++; }, track });
  await wrong.start();
  await idle(set);
  assert.equal(mismatches, 2);
  assert.equal(other.saveCalls, 0);
});

test('progressSync: nothing is published while the account-change restart runs', async () => {
  const portal = fakePortal();
  const { set, track } = localTrack();
  const sync = progressSync(fakeKit(portal), gameHook({ storiesUnlocked: 0, correctTotal: 1 }), { cookie: () => cookieFor('u1'), isRestarting: () => true, track });
  await sync.start();
  await idle(set);
  assert.equal(portal.saveCalls, 0);
});

test('trackPending: a tracked start-up holds flushAwards until it settles, a rejection included', async () => {
  let fail;
  const startUp = new Promise((_, reject) => { fail = reject; });
  startUp.catch(() => {});
  assert.equal(trackPending(startUp), startUp, 'returns the promise unchanged');
  assert.equal(pendingAwardCount(), 1);
  let flushed = null;
  const flush = flushAwards(5000).then((v) => { flushed = v; });
  await new Promise((r) => setImmediate(r));
  assert.equal(flushed, null);
  fail(new Error('portal down'));
  await flush;
  assert.equal(flushed, true);
  assert.equal(pendingAwardCount(), 0);
});

test('mockKit: load returns {} until a save, saves are recorded, a lower rev is dropped', async () => {
  const win = {};
  const kit = mockKit(win);
  assert.deepEqual(await kit.load(), {});
  await kit.save({ rev: 4, storiesUnlocked: 1, correctTotal: 4 }, { headline: '4 words forged · 1 of 18 stories', percent: 6 });
  await kit.save({ rev: 2, storiesUnlocked: 0, correctTotal: 2 }, { headline: '2 words forged · 0 of 18 stories', percent: 0 });
  assert.deepEqual(await kit.load(), { rev: 4, storiesUnlocked: 1, correctTotal: 4 });
  assert.deepEqual(win.__kitSaves.map((s) => s.summary.headline), ['4 words forged · 1 of 18 stories', '2 words forged · 0 of 18 stories']);
});
