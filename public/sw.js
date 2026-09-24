/* Word Forge service worker.
 *
 * Everything here is relative: the app is served at the site root of
 * wordforge.travelschooling.com (it used to live under /Word_Forge/ on GitHub Pages).
 *
 * Strategy is deliberately split:
 *   - the page itself is NETWORK-FIRST, so a new deploy reaches installed
 *     users on their next online load instead of waiting for a cache bump;
 *   - fonts and icons are CACHE-FIRST, because they are content-hashed by
 *     name and effectively immutable.
 *
 * The page is behind the portal's login gate. A page response is stored only when
 * self.WF_POLICY.cacheablePage says so (200, not redirected, same origin), so a session
 * that expired between visits never stores the portal's login page as the offline copy
 * of the game. Offline, an already-cached copy still opens: nothing leaves the device and
 * the kit cannot award offline.
 */
importScripts("sw-policy.js");

const CACHE = "word-forge-v2";
const OLD_CACHES = ["word-forge-v1"];

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./kit.js",
  "./sw-policy.js",
  "./fonts/baloo2.woff2",
  "./fonts/nunito.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

function isPageUrl(url) {
  return url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
}

/** Warm one shell entry; page entries obey the policy, assets only need a 200. */
function warm(cache, url) {
  return fetch(url, { credentials: "same-origin" })
    .then((response) => {
      const ok = isPageUrl(new URL(response.url || url, self.location.href))
        ? self.WF_POLICY.cacheablePage(response, self.location.origin)
        : response.ok;
      return ok ? cache.put(url, response) : undefined;
    })
    .catch(() => undefined);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One bad entry must not fail the whole install, so warm them individually.
      .then((cache) => Promise.allSettled(SHELL.map((url) => warm(cache, url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && (OLD_CACHES.includes(key) || key.startsWith("word-forge-"))).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isPage = request.mode === "navigate" || isPageUrl(url);

  if (isPage) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (self.WF_POLICY.cacheablePage(response, self.location.origin)) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        // Offline: serve the last good copy of the page.
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
