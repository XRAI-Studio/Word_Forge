/* Word Forge service worker.
 *
 * Everything here is relative, because the app is served from a project
 * subpath (/Word_Forge/) rather than a domain root.
 *
 * Strategy is deliberately split:
 *   - the page itself is NETWORK-FIRST, so a new deploy reaches installed
 *     users on their next online load instead of waiting for a cache bump;
 *   - fonts and icons are CACHE-FIRST, because they are content-hashed by
 *     name and effectively immutable.
 */
const CACHE = "word-forge-v1";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./fonts/baloo2.woff2",
  "./fonts/nunito.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One bad entry must not fail the whole install, so warm them individually.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isPage = request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");

  if (isPage) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
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
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
