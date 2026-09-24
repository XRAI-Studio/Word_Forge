// Selection logic for the GitHub Pages redirect stub (branch gh-pages). The stub inlines
// this function verbatim: xrai-studio.github.io is one origin shared by every project
// site, so the stub may only touch Word Forge's own service worker registration and caches.
//
// registrations: [{ scope: string }], cacheNames: string[]
// -> { unregister: [{ scope }], deleteCaches: string[] }
export function selectWordForgeCleanup({ registrations = [], cacheNames = [] } = {}) {
  const unregister = registrations.filter((r) => typeof r.scope === 'string' && /\/Word_Forge\/$/.test(r.scope));
  const deleteCaches = cacheNames.filter((n) => n === 'word-forge-v1' || n === 'word-forge-v2');
  return { unregister, deleteCaches };
}
