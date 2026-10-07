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

// ---- cross-device sync, Plan 3: per-session correct-answer counts (Task 1) ----

const { syncState, mergeSync, syncTotal, storiesFor, syncSummary } = await import('../public/kit.js');

test('syncState converts v1 to a legacy bucket and junk to empty', () => {
  assert.deepEqual(syncState({ rev: 9, storiesUnlocked: 3, correctTotal: 9 }), { v: 2, correct: { legacy: 9 } });
  assert.deepEqual(syncState({ rev: 0, storiesUnlocked: 0, correctTotal: 0 }), { v: 2, correct: {} });
  assert.deepEqual(syncState({ v: 2, correct: { pc: 2, legacy: 9 } }), { v: 2, correct: { legacy: 9, pc: 2 } });
  assert.deepEqual(Object.keys(syncState({ v: 2, correct: { pc: 2, legacy: 9 } }).correct), ['legacy', 'pc'], 'keys sorted');
  assert.deepEqual(syncState(null), { v: 2, correct: {} });
  assert.deepEqual(syncState('junk'), { v: 2, correct: {} });
  assert.deepEqual(syncState({ v: 2, correct: { pc: -1, phone: 'x', tab: 2.5 } }), { v: 2, correct: { tab: 2 } });
});

test('mergeSync is prototype-safe: unusual keys round-trip and merge', () => {
  const odd = JSON.parse('{"v":2,"correct":{"constructor":1,"toString":2,"__proto__":3}}');
  const m = mergeSync(odd, { v: 2, correct: {} });
  assert.equal(syncTotal(m), 6);
  assert.equal(Object.keys(m.correct).length, 3);
  assert.equal(mergeSync({ v: 2, correct: {} }, odd).correct.constructor, 1);
  assert.equal(syncTotal(JSON.parse(JSON.stringify(m))), 6, 'survives a JSON round trip');
  assert.equal(syncTotal(mergeSync({ v: 2, correct: { pc: 1 } }, { v: 2, correct: {} })), 1, 'absent keys never read the prototype');
});

test('mergeSync adds devices, max-merges each device, and derives stories', () => {
  const m = mergeSync({ v: 2, correct: { legacy: 9, pc: 2 } }, { v: 2, correct: { legacy: 9, phone: 4 } });
  assert.deepEqual(m, { v: 2, correct: { legacy: 9, pc: 2, phone: 4 } });
  assert.equal(syncTotal(m), 15);
  assert.equal(storiesFor(15, 12), 5);
  assert.equal(storiesFor(100, 12), 12);
  assert.equal(storiesFor(2, 12), 0);
  assert.match(syncSummary(m, 12).headline, /^15 words forged · 5 of 12 stories$/);
});

/** The plan's simulated devices: answers in a device's own bucket, and pairwise syncs. */
function simulateDevices(seed) {
  const rng = (s) => { let x = s >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
  const r = rng(seed), devices = ['pc', 'phone', 'tablet'];
  const st = new Map(devices.map((d) => [d, syncState({ correctTotal: 5 })]));
  for (let i = 0; i < 60; i++) {
    const d = devices[Math.floor(r() * 3)], s = st.get(d);
    if (r() < 0.6) st.set(d, { v: 2, correct: { ...s.correct, [d]: (s.correct[d] ?? 0) + 1 } });
    else { const o = devices.filter((x) => x !== d)[Math.floor(r() * 2)]; const m = mergeSync(s, st.get(o)); st.set(d, m); if (r() < 0.5) st.set(o, m); }
  }
  return devices.map((d) => syncState(st.get(d)));
}

for (const [name, check] of [
  ['idempotent', ([a]) => assert.deepEqual(mergeSync(a, a), a)],
  ['commutative', ([a, b]) => assert.deepEqual(mergeSync(a, b), mergeSync(b, a))],
  ['associative', ([a, b, c]) => assert.deepEqual(mergeSync(mergeSync(a, b), c), mergeSync(a, mergeSync(b, c)))],
  ['loses no device count', ([a, b]) => { const m = mergeSync(a, b); for (const k of Object.keys({ ...a.correct, ...b.correct })) assert.equal(m.correct[k], Math.max(a.correct[k] ?? 0, b.correct[k] ?? 0)); }],
  ['the total is the sum of the devices, not the higher of two', ([a, b]) => { const m = mergeSync(a, b); assert.ok(syncTotal(m) >= Math.max(syncTotal(a), syncTotal(b))); }],
]) {
  test(`mergeSync algebra on simulated devices (600 seeds): ${name}`, () => { for (let seed = 1; seed <= 600; seed++) check(simulateDevices(seed)); });
}

test('Review Focus 1: phone and PC each answer offline; the merge is the sum, stories follow it', () => {
  const base = syncState({ correctTotal: 6, storiesUnlocked: 2, rev: 6 });
  const pc = mergeSync(base, { v: 2, correct: { 's.pc1': 4 } });
  const phone = mergeSync(base, { v: 2, correct: { 's.ph1': 5 } });
  const m = mergeSync(pc, phone);
  assert.equal(syncTotal(m), 15);
  assert.equal(storiesFor(syncTotal(m), 18), 5);
});

test('Review Focus 2: v1 progress on both devices at switch-on is not doubled (legacy max-merges)', () => {
  const pc = mergeSync(syncState({ correctTotal: 9, storiesUnlocked: 3, rev: 9 }), { v: 2, correct: { 's.pc': 1 } });
  const phone = syncState({ correctTotal: 11, storiesUnlocked: 3, rev: 11 });
  const m = mergeSync(pc, phone);
  assert.deepEqual(m, { v: 2, correct: { legacy: 11, 's.pc': 1 } });
  assert.equal(syncTotal(m), 12, 'the larger legacy total plus this device\'s new answer');
});

// ---- cross-device sync, Plan 3: progressSync with a versioned kit (Task 2) ----

const ARRIVAL = 'Updated with your work from your other device.';
const SAFE_MODE = "Can't sync on this device right now. Your work is kept here.";

/** A versioned kit over one shared server copy: saves merge into it and answer `merged`. */
function fakeVersionedKit(server, { deviceId = 'pc', broken = false } = {}) {
  const calls = { saves: [], toasts: [], refreshes: 0 };
  const kit = {
    mock: true, deviceId, syncBroken: broken, user: { id: 'u1' },
    load: async () => server.state,
    save: async (state, summary) => {
      calls.saves.push({ state, summary });
      const merged = mergeSync(server.state, state);
      server.state = merged;
      return { stored: 'server', merged };
    },
    refresh: async (current) => {
      calls.refreshes++;
      const m = mergeSync(current, server.state);
      return JSON.stringify(m) !== JSON.stringify(syncState(current)) ? { changed: true, state: m } : { changed: false };
    },
    toast: (t) => calls.toasts.push(t),
    award: async () => ({}),
  };
  return { kit, calls };
}
/** The game hook's synced-state side; `markUnsaved` simulates a failed local entry write. */
function fakeHook(state) {
  let st = syncState(state);
  let unsaved = false;
  const hook = {
    learner: 'u1', storyCount: 12, markUnsaved: false, acks: [],
    getState: () => st,
    setState: (x) => { st = mergeSync(st, x); },
    addCorrect: (bucket) => {
      st = mergeSync(st, { v: 2, correct: { [bucket]: (st.correct[bucket] ?? 0) + 1 } });
      unsaved = hook.markUnsaved;
      return st;
    },
    unsaved: () => unsaved,
    clearUnsaved: () => { unsaved = false; },
    acknowledged: (ack) => { hook.acks.push(ack); },
    get: () => ({ correctTotal: syncTotal(st), storiesUnlocked: storiesFor(syncTotal(st), 12) }),
  };
  return hook;
}
const settle = () => new Promise((r) => setTimeout(r, 50));
const VOPTS = (extra = {}) => ({ cookie: () => '', track: localTrack().track, ...extra });

test('versioned: answers made while the first load is pending still count (no subtraction from a stale total)', async () => {
  const server = { state: { v: 2, correct: { legacy: 10, 'phone.a': 4 } } };
  const { kit, calls } = fakeVersionedKit(server);
  const hook = fakeHook({ v: 2, correct: { legacy: 10 } });
  hook.addCorrect('pc.s1'); hook.addCorrect('pc.s1'); // two answers before start
  const sync = progressSync(kit, hook, VOPTS());
  await sync.start(); await settle();
  assert.equal(hook.get().correctTotal, 16);
  assert.equal(syncTotal(server.state), 16);
  assert.ok(calls.toasts.includes(ARRIVAL), 'the phone’s answers arrived');
  assert.deepEqual(calls.saves.at(-1).summary, { headline: '16 words forged · 5 of 12 stories', percent: 42 });
});

test('versioned: a session bucket is never renamed, so a provisional count cannot be counted twice', async () => {
  const server = { state: { v: 2, correct: { legacy: 3 } } };
  const tabA = fakeVersionedKit(server), tabB = fakeVersionedKit(server);
  const hookA = fakeHook(server.state);
  hookA.addCorrect('s.A');
  const hookB = fakeHook(hookA.getState());
  const b = progressSync(tabB.kit, hookB, VOPTS()); await b.start();
  const a = progressSync(tabA.kit, hookA, VOPTS()); await a.start(); await settle();
  assert.equal(syncTotal(server.state), 4);
});

test('versioned: two tabs in one browser count in separate session buckets', async () => {
  const server = { state: { v: 2, correct: { legacy: 10 } } };
  const tabA = fakeVersionedKit(server), tabB = fakeVersionedKit(server);
  const hookA = fakeHook(server.state), hookB = fakeHook(server.state);
  const a = progressSync(tabA.kit, hookA, VOPTS()), b = progressSync(tabB.kit, hookB, VOPTS());
  await a.start(); await b.start();
  hookA.addCorrect('s.A'); a.publish(); hookB.addCorrect('s.B'); b.publish(); await settle();
  assert.equal(syncTotal(server.state), 12);
});

test('versioned: a save whose result carries `merged` adopts it, with the notice', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit, calls } = fakeVersionedKit(server);
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS());
  await sync.start();
  server.state = { v: 2, correct: { 's.phone': 3 } }; // the phone saved meanwhile
  hook.addCorrect('s.pc'); sync.publish(); await settle();
  assert.equal(hook.get().correctTotal, 4);
  assert.deepEqual(calls.toasts, [ARRIVAL]);
});

test('Review Focus 3: a tab left open picks up the other device on refresh, with the notice', async () => {
  const server = { state: { v: 2, correct: { legacy: 10 } } };
  const pc = fakeVersionedKit(server, { deviceId: 'pc' });
  const pcHook = fakeHook(server.state);
  const pcSync = progressSync(pc.kit, pcHook, VOPTS());
  await pcSync.start();
  server.state = mergeSync(server.state, { v: 2, correct: { 'phone.x': 5 } });
  await pcSync.refresh();
  assert.equal(pcHook.get().correctTotal, 15);
  assert.equal(pcHook.get().storiesUnlocked, 5);
  assert.ok(pc.calls.toasts.includes(ARRIVAL));
  await pcSync.refresh();
  assert.equal(pc.calls.toasts.filter((t) => t === ARRIVAL).length, 1, 'no notice when nothing arrived');
});

test('versioned: refresh is skipped while a publish is in flight', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit, calls } = fakeVersionedKit(server);
  let release; const gate = new Promise((r) => { release = r; });
  const realSave = kit.save;
  kit.save = async (st, sum) => { await gate; return realSave(st, sum); };
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS());
  await sync.start();
  hook.addCorrect('s.a'); sync.publish();
  await sync.refresh();
  assert.equal(calls.refreshes, 0);
  release(); await settle();
  await sync.refresh();
  assert.equal(calls.refreshes, 1);
});

test('versioned: startup always publishes non-empty local state and retries until the server acknowledges', async () => {
  const server = { state: { v: 2, correct: { 's.old': 1 } } };
  const { kit } = fakeVersionedKit(server);
  let offline = true; const realSave = kit.save; const saves = [];
  kit.save = async (st, sum) => { saves.push(st); return offline ? { stored: 'local' } : realSave(st, sum); };
  const hook = fakeHook({ v: 2, correct: { 's.old': 1 } });
  const win = new EventTarget();
  const sync = progressSync(kit, hook, VOPTS({ win }));
  await sync.start(); await settle();
  assert.equal(saves.length, 1, 'published although the server already holds the same state (CDS3-011)');
  offline = false; win.dispatchEvent(new Event('online')); await settle();
  assert.equal(saves.length, 2);
  win.dispatchEvent(new Event('online')); await settle();
  assert.equal(saves.length, 2, 'acknowledged: no more retries');
  assert.equal(hook.acks.length, 1, 'the acknowledgement reaches the hook for cleanup');
});

test('versioned: a save that stayed local is retried on reconnect without another answer', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit } = fakeVersionedKit(server);
  let offline = true;
  const realSave = kit.save;
  kit.save = async (st, sum) => (offline ? { stored: 'local' } : realSave(st, sum));
  const hook = fakeHook(server.state);
  const win = new EventTarget();
  const sync = progressSync(kit, hook, VOPTS({ win }));
  await sync.start(); hook.addCorrect('s.pc'); sync.publish(); await settle();
  assert.equal(syncTotal(server.state), 0);
  assert.equal(hook.acks.length, 0, 'no cleanup without a server acknowledgement');
  offline = false; win.dispatchEvent(new Event('online')); await settle();
  assert.equal(syncTotal(server.state), 1);
});

test('versioned: the retry also runs every 30 s on one timer, which stops once acknowledged', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit } = fakeVersionedKit(server);
  let offline = true;
  const realSave = kit.save;
  kit.save = async (st, sum) => (offline ? { stored: 'none' } : realSave(st, sum));
  const timers = new Map(); let nextId = 1;
  const setIntervalFn = (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; };
  const clearIntervalFn = (id) => { timers.delete(id); };
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS({ win: new EventTarget(), setInterval: setIntervalFn, clearInterval: clearIntervalFn }));
  await sync.start(); hook.addCorrect('s.pc'); sync.publish(); await settle();
  hook.addCorrect('s.pc'); sync.publish(); await settle();
  assert.equal(timers.size, 1, 'one timer');
  assert.equal([...timers.values()][0].ms, 30_000);
  offline = false;
  [...timers.values()][0].fn(); await settle();
  assert.equal(syncTotal(server.state), 2);
  assert.equal(timers.size, 0, 'stopped');
});

test('versioned: an acknowledgement that contains the current state clears the unsaved status', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit } = fakeVersionedKit(server);
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS());
  await sync.start();
  hook.markUnsaved = true; hook.addCorrect('s.a');
  assert.equal(sync.unsaved(), true);
  sync.publish(); await settle();
  assert.equal(sync.unsaved(), false);
});

test('versioned: an acknowledgement of an older snapshot never clears the unsaved status', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit } = fakeVersionedKit(server);
  let release; const gate = new Promise((r) => { release = r; });
  const realSave = kit.save; let n = 0;
  kit.save = async (st, sum) => { n++; if (n === 1) { await gate; return realSave(st, sum); } return { stored: 'none' }; };
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS({ win: new EventTarget() }));
  await sync.start(); hook.addCorrect('s.a'); sync.publish();
  hook.markUnsaved = true; hook.addCorrect('s.a'); sync.publish(); // S2: its local write failed
  release(); await settle();
  assert.equal(n, 2);
  assert.equal(sync.unsaved(), true);
});

test('Review Focus 5: safe mode is announced once, retries stop, and the page keeps working locally', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit, calls } = fakeVersionedKit(server, { broken: true });
  kit.save = async (st, sum) => { calls.saves.push({ st, sum }); return { stored: 'local' }; };
  const timers = new Map(); let nextId = 1;
  const win = new EventTarget();
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS({ win, setInterval: (fn, ms) => { const id = nextId++; timers.set(id, fn); return id; }, clearInterval: (id) => timers.delete(id) }));
  await sync.start(); await sync.refresh();
  hook.addCorrect('s.a'); sync.publish(); await settle();
  win.dispatchEvent(new Event('online')); await settle();
  assert.deepEqual(calls.toasts.filter((t) => t.startsWith("Can't sync")), [SAFE_MODE]);
  assert.equal(timers.size, 0, 'no retry timer in safe mode');
  assert.equal(calls.saves.length, 1, 'no retry on online in safe mode');
  assert.equal(hook.get().correctTotal, 1, 'the answer still counts here');
});

test('versioned: safe mode entered by a later save is announced then, once', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit, calls } = fakeVersionedKit(server);
  kit.save = async () => { kit.syncBroken = true; return { stored: 'local' }; };
  const hook = fakeHook(server.state);
  const sync = progressSync(kit, hook, VOPTS({ win: new EventTarget() }));
  await sync.start();
  assert.deepEqual(calls.toasts, []);
  hook.addCorrect('s.a'); sync.publish(); await settle();
  hook.addCorrect('s.a'); sync.publish(); await settle();
  await sync.refresh();
  assert.deepEqual(calls.toasts, [SAFE_MODE]);
});

test('versioned: refused for another learner, as before', async () => {
  const server = { state: { v: 2, correct: {} } };
  const { kit, calls } = fakeVersionedKit(server);
  kit.mock = false;
  let mismatches = 0;
  const hook = fakeHook({ v: 2, correct: { 's.a': 1 } });
  const sync = progressSync(kit, hook, VOPTS({ cookie: () => cookieFor('u2'), onMismatch: () => { mismatches++; } }));
  await sync.start(); await settle();
  assert.equal(mismatches, 1);
  assert.equal(calls.saves.length, 0);
});

test('initKit opts in to the versioned kit with the merge and a summary over the story count', async () => {
  let opts = null;
  const kit = { user: { id: 'u1' } };
  const r = await initKit({ hostname: 'wordforge.travelschooling.com', TSKit: { init: async (o) => { opts = o; return kit; } }, storyCount: 18, win: {} });
  assert.equal(r.kit, kit);
  assert.equal(opts.game, GAME);
  assert.equal(opts.merge, mergeSync);
  assert.deepEqual(opts.summarize({ v: 2, correct: { a: 4, b: 3 } }), { headline: '7 words forged · 2 of 18 stories', percent: 11 });
});

test('initKit uses window.__tsTestKit (e2e seam) instead of the localhost mock', async () => {
  let opts = null;
  const kit = { user: { id: 'dev' }, mock: true };
  const win = { __tsTestKit: { init: async (o) => { opts = o; return kit; } } };
  const r = await initKit({ hostname: 'localhost', storyCount: 18, win });
  assert.equal(r.kit, kit);
  assert.equal(opts.merge, mergeSync);
});

test('the localhost mock opts in too: versioned, merges saves, answers merged, refreshes', async () => {
  const win = {};
  const r = await initKit({ hostname: 'localhost', storyCount: 18, win });
  const kit = r.kit;
  assert.equal(typeof kit.refresh, 'function');
  assert.equal(typeof kit.deviceId, 'string');
  assert.equal(kit.syncBroken, false);
  assert.deepEqual(await kit.load(), {});
  assert.deepEqual(await kit.save({ v: 2, correct: { a: 2 } }, { headline: 'x' }), { stored: 'server' });
  assert.deepEqual(await kit.save({ v: 2, correct: { b: 1 } }, { headline: 'y' }), { stored: 'server', merged: { v: 2, correct: { a: 2, b: 1 } } });
  assert.deepEqual(await kit.refresh({ v: 2, correct: { b: 1 } }), { changed: true, state: { v: 2, correct: { a: 2, b: 1 } } });
  assert.deepEqual(await kit.refresh({ v: 2, correct: { a: 2, b: 1 } }), { changed: false });
  assert.equal(win.__kitSaves.length, 2);
});
