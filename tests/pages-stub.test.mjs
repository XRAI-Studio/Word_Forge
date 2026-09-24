import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWordForgeCleanup } from '../tools/pages-stub/cleanup.js';

test('selects only the Word Forge registration and caches on the shared github.io origin', () => {
  const registrations = [
    { scope: 'https://xrai-studio.github.io/Other_App/' },
    { scope: 'https://xrai-studio.github.io/Word_Forge/' },
    { scope: 'https://xrai-studio.github.io/' },
  ];
  const cacheNames = ['other-app-v3', 'word-forge-v1', 'word-forge-v2', 'katas-viewer-v1'];
  const r = selectWordForgeCleanup({ registrations, cacheNames });
  assert.deepEqual(r.unregister.map((x) => x.scope), ['https://xrai-studio.github.io/Word_Forge/']);
  assert.deepEqual(r.deleteCaches, ['word-forge-v1', 'word-forge-v2']);
});

test('an unrelated same-origin registration and cache survive when Word Forge has nothing', () => {
  const r = selectWordForgeCleanup({ registrations: [{ scope: 'https://xrai-studio.github.io/Other_App/' }], cacheNames: ['other-app-v3'] });
  assert.deepEqual(r, { unregister: [], deleteCaches: [] });
});

test('tolerates missing inputs and odd registrations', () => {
  assert.deepEqual(selectWordForgeCleanup(), { unregister: [], deleteCaches: [] });
  assert.deepEqual(selectWordForgeCleanup({ registrations: [{}, { scope: 42 }], cacheNames: [] }), { unregister: [], deleteCaches: [] });
});
