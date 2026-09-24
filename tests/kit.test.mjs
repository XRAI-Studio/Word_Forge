import test from 'node:test';
import assert from 'node:assert/strict';
import { award, initKit, isDevHost, mockKit, sameAccount, sessionUserId, GAME } from '../public/kit.js';

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
