/* Replacement worker for the old GitHub Pages copy of Word Forge (scope /Word_Forge/).
 * The old worker fetched the page network-first, so it picks this file up on the next
 * online load, installs it, and this worker then unregisters itself and sends every open
 * client to the new host. Its scope is /Word_Forge/, so it touches nothing else on the
 * shared xrai-studio.github.io origin. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch (e) {
        // best effort
      }
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.allSettled(clients.map((c) => c.navigate("https://wordforge.travelschooling.com/")));
    })()
  );
});
