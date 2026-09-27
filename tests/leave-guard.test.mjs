import test from 'node:test';
import assert from 'node:assert/strict';

// leave-guard.js is a plain script that sets self.WF_LEAVE (index.html loads it with a
// <script> tag). Give it a `self` and import it for its side effect.
globalThis.self = globalThis;
await import('../public/leave-guard.js');
const { createLeaveGuard } = globalThis.WF_LEAVE;

function setup({ unsaved = false, flush = () => undefined } = {}) {
  const win = new EventTarget();
  const state = { unsaved, navigations: 0, dialogs: 0, requests: 0 };
  const guard = createLeaveGuard({
    win,
    hasUnsavedWork: () => state.unsaved,
    flush: () => flush(),
    navigate: () => { state.navigations++; },
    openDialog: () => { state.dialogs++; },
    beforeRequest: () => { state.requests++; },
  });
  return { win, state, guard };
}

/** Dispatches beforeunload and reports whether the page asked to stay. */
function unloadPrompted(win) {
  const e = new Event('beforeunload', { cancelable: true });
  win.dispatchEvent(e);
  return e.defaultPrevented;
}

function pageshow(win, persisted) {
  const e = new Event('pageshow');
  e.persisted = persisted;
  win.dispatchEvent(e);
}

test('beforeunload is armed only while there is unsaved work', () => {
  const { win, state, guard } = setup();
  guard.sync();
  assert.equal(unloadPrompted(win), false);
  state.unsaved = true;
  guard.sync();
  assert.equal(guard.isArmed(), true);
  assert.equal(unloadPrompted(win), true);
  guard.sync(); // idempotent: still exactly one listener
  state.unsaved = false;
  guard.sync();
  assert.equal(guard.isArmed(), false);
  assert.equal(unloadPrompted(win), false);
});

test('the button with unsaved work opens the dialog and does not navigate', async () => {
  const { state, guard } = setup({ unsaved: true });
  assert.equal(await guard.request(), false);
  assert.equal(state.dialogs, 1);
  assert.equal(state.navigations, 0);
  assert.equal(state.requests, 1, 'beforeRequest runs first (retry a failed save)');
});

test('the button with nothing unsaved waits for the flush, then navigates once', async () => {
  let release;
  const { state, guard } = setup({ flush: () => new Promise((r) => { release = r; }) });
  const first = guard.request();
  const second = guard.request(); // double click during the departure
  await new Promise((r) => setImmediate(r));
  assert.equal(state.navigations, 0, 'waits for the flush');
  release();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(state.navigations, 1);
  assert.equal(state.dialogs, 0);
});

test('a flush that throws or rejects still navigates', async () => {
  const a = setup({ flush: () => { throw new Error('x'); } });
  assert.equal(await a.guard.request(), true);
  const b = setup({ flush: () => Promise.reject(new Error('y')) });
  assert.equal(await b.guard.request(), true);
  assert.equal(a.state.navigations + b.state.navigations, 2);
});

test('leave without saving disarms the prompt first and stays disarmed while leaving', async () => {
  const { win, state, guard } = setup({ unsaved: true });
  guard.sync();
  assert.equal(unloadPrompted(win), true);
  const left = guard.leave();
  assert.equal(unloadPrompted(win), false, 'disarmed before the navigation');
  guard.sync(); // a game re-render during the departure must not re-arm it
  assert.equal(unloadPrompted(win), false);
  assert.equal(await left, true);
  assert.equal(state.navigations, 1);
});

test('leave -> restore from the back/forward cache -> leave works again', async () => {
  const { win, state, guard } = setup();
  assert.equal(await guard.request(), true);
  assert.equal(guard.isLeaving(), true);
  assert.equal(await guard.request(), false, 'ignored while the departure is active');
  pageshow(win, false); // an ordinary load is not a restore
  assert.equal(guard.isLeaving(), true);
  pageshow(win, true);
  assert.equal(guard.isLeaving(), false);
  assert.equal(await guard.request(), true);
  assert.equal(state.navigations, 2);
});

test('a restore re-evaluates the prompt: no stale listener, re-armed only if work is unsaved', async () => {
  const { win, state, guard } = setup({ unsaved: true });
  guard.sync();
  await guard.leave(); // "Leave without saving"
  assert.equal(unloadPrompted(win), false);
  state.unsaved = false;
  pageshow(win, true);
  assert.equal(unloadPrompted(win), false, 'nothing unsaved after restore: no prompt');
  state.unsaved = true;
  guard.sync();
  assert.equal(unloadPrompted(win), true, 'live again: unsaved work arms it');
  await guard.leave();
  state.unsaved = true;
  pageshow(win, true);
  assert.equal(unloadPrompted(win), true, 'restored with the half-built word: armed again');
});
