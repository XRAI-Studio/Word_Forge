import test from 'node:test';
import assert from 'node:assert/strict';

// leave-guard.js is a plain script that sets self.WF_LEAVE (index.html loads it with a
// <script> tag). Give it a `self` and import it for its side effect.
globalThis.self = globalThis;
await import('../public/leave-guard.js');
const { createLeaveGuard } = globalThis.WF_LEAVE;

function setup({ unsaved = false, flush = () => undefined } = {}) {
  const win = new EventTarget();
  const state = { unsaved, navigations: 0, dialogs: 0, requests: 0, busy: false, busyLog: [], timers: [] };
  const guard = createLeaveGuard({
    win,
    hasUnsavedWork: () => state.unsaved,
    flush: () => flush(state),
    navigate: () => { state.navigations++; },
    openDialog: () => { state.dialogs++; },
    beforeRequest: () => { state.requests++; },
    setBusy: (b) => { state.busy = b; state.busyLog.push(b); },
    schedule: (fn, ms) => { state.timers.push({ fn, ms }); },
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

const tick = () => new Promise((r) => setImmediate(r));

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
  assert.deepEqual(state.busyLog, [], 'controls untouched');
});

test('a clean departure disables the controls, waits for the flush, then navigates once', async () => {
  let release;
  const { state, guard } = setup({ flush: () => new Promise((r) => { release = r; }) });
  const first = guard.request();
  const second = guard.request(); // double click during the departure
  await tick();
  assert.equal(state.busy, true, 'controls disabled during the wait');
  assert.equal(state.navigations, 0, 'waits for the flush');
  release();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(state.navigations, 1);
  assert.equal(state.dialogs, 0);
});

test('a clean departure is cancelled when work became unsaved during the wait (new word)', async () => {
  let first = true;
  const { win, state, guard } = setup({
    // e.g. a tile snapped just before the controls locked (first departure only)
    flush: (s) => { if (first) s.unsaved = true; first = false; },
  });
  assert.equal(await guard.request(), false);
  assert.equal(state.navigations, 0, 'did not navigate');
  assert.equal(state.dialogs, 1, 'opened the dialog instead');
  assert.deepEqual(state.busyLog, [true, false], 'controls back');
  assert.equal(unloadPrompted(win), true, 'the prompt protects the new work');
  assert.equal(guard.isDeparting(), false);
  // The learner finishes the word; the button works again.
  state.unsaved = false;
  assert.equal(await guard.request(), true);
  assert.equal(state.navigations, 1);
});

test('a clean departure is cancelled when a progress write failed during the wait', async () => {
  let failWrite;
  const { state, guard } = setup({ flush: (s) => new Promise((r) => { failWrite = () => { s.unsaved = true; r(); }; }) });
  const leaving = guard.request();
  await tick();
  failWrite();
  assert.equal(await leaving, false);
  assert.equal(state.navigations, 0);
  assert.equal(state.dialogs, 1);
});

test('a flush that throws or rejects still navigates', async () => {
  const a = setup({ flush: () => { throw new Error('x'); } });
  assert.equal(await a.guard.request(), true);
  const b = setup({ flush: () => Promise.reject(new Error('y')) });
  assert.equal(await b.guard.request(), true);
  assert.equal(a.state.navigations + b.state.navigations, 2);
});

test('leave without saving disarms the prompt first and navigates whatever is unsaved', async () => {
  const { win, state, guard } = setup({ unsaved: true });
  guard.sync();
  assert.equal(unloadPrompted(win), true);
  const left = guard.discard();
  assert.equal(unloadPrompted(win), false, 'disarmed before the navigation');
  assert.equal(state.busy, true, 'controls disabled during the wait');
  guard.sync(); // a game re-render during the departure must not re-arm it
  assert.equal(unloadPrompted(win), false);
  assert.equal(await guard.discard(), false, 'a second press is ignored');
  assert.equal(await left, true);
  assert.equal(state.navigations, 1);
  assert.equal(state.dialogs, 0);
});

test('leave -> restore from the back/forward cache -> leave works again', async () => {
  const { win, state, guard } = setup();
  assert.equal(await guard.request(), true);
  assert.equal(guard.isDeparting(), true);
  assert.equal(await guard.request(), false, 'ignored while the departure is active');
  pageshow(win, false); // an ordinary load is not a restore
  assert.equal(guard.isDeparting(), true);
  pageshow(win, true);
  assert.equal(guard.isDeparting(), false);
  assert.equal(state.busy, false, 'controls back after the restore');
  assert.equal(await guard.request(), true);
  assert.equal(state.navigations, 2);
});

test('a restore after leave without saving re-evaluates the prompt: no stale listener, re-armed if unsaved', async () => {
  const { win, state, guard } = setup({ unsaved: true });
  guard.sync();
  await guard.discard();
  assert.equal(unloadPrompted(win), false);
  state.unsaved = false;
  pageshow(win, true);
  assert.equal(unloadPrompted(win), false, 'nothing unsaved after restore: no prompt');
  state.unsaved = true;
  guard.sync();
  assert.equal(unloadPrompted(win), true, 'live again: unsaved work arms it');
  await guard.discard();
  pageshow(win, true);
  assert.equal(unloadPrompted(win), true, 'restored with the half-built word: armed again');
});

test('allowUnload lets the page reload itself without the prompt, and can restore it', () => {
  const { win, state, guard } = setup({ unsaved: true });
  guard.sync();
  guard.allowUnload(true);
  assert.equal(unloadPrompted(win), false);
  guard.sync();
  assert.equal(unloadPrompted(win), false, 'stays released');
  guard.allowUnload(false);
  assert.equal(unloadPrompted(win), true, 'protection back');
  state.unsaved = false;
  guard.sync();
  assert.equal(unloadPrompted(win), false);
});

test('a cancelled clean departure (still here after 3 s) gives the page back', async () => {
  const { state, guard } = setup();
  assert.equal(await guard.request(), true);
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0].ms, 3000);
  assert.equal(await guard.request(), false, 'duplicate press during the attempt is ignored');
  state.timers.shift().fn(); // the browser's Stop: the document is still here
  assert.equal(guard.isDeparting(), false);
  assert.equal(state.busy, false, 'controls back');
  assert.equal(await guard.request(), true, 'the button works again');
  assert.equal(state.navigations, 2);
});

test('a cancelled discard re-arms the prompt when work is still unsaved', async () => {
  const { win, state, guard } = setup({ unsaved: true });
  guard.sync();
  assert.equal(await guard.discard(), true);
  assert.equal(unloadPrompted(win), false);
  state.timers.shift().fn();
  assert.equal(guard.isDeparting(), false);
  assert.equal(state.busy, false);
  assert.equal(unloadPrompted(win), true, 'protection back for the unsaved word');
  assert.equal(await guard.request(), false, 'the button asks again');
  assert.equal(state.dialogs, 1);
});

test('a late stall timer from an older attempt does not end the current one', async () => {
  const { win, state, guard } = setup();
  await guard.request();
  const old = state.timers.shift().fn;
  pageshow(win, true); // Back: restored from the cache
  await guard.request(); // leaving again
  old(); // the first attempt's timer fires late
  assert.equal(guard.isDeparting(), true, 'current attempt untouched');
  assert.equal(state.busy, true);
  state.timers.shift().fn();
  assert.equal(guard.isDeparting(), false, 'its own timer ends it');
});
