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
