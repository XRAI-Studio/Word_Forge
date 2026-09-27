import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChangeRestart, award, flushAwards, RESTART_LOSS_TEXT, RESTART_STALLED_TEXT, RESTART_TEXT, initKit, isDevHost, mockKit, pendingAwardCount, sameAccount, sessionUserId, GAME } from '../public/kit.js';

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
