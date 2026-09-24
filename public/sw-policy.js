/* Word Forge service-worker policy. Loaded by sw.js through importScripts (it sets
 * self.WF_POLICY) and imported by tests/sw-policy.test.mjs, so it must be plain script
 * with no exports.
 *
 * The game page is behind the portal's login gate. A page fetch made while the session
 * has expired follows the gate's 307 to the portal login, and a naive network-first
 * worker would then store the LOGIN page as the offline copy of the game. So a page
 * response is cacheable only when it is a 200, was not redirected, and came from this
 * origin.
 */
(function (root) {
  function cacheablePage(response, selfOrigin) {
    if (!response || response.status !== 200) return false;
    if (response.redirected) return false;
    try {
      return new URL(response.url).origin === selfOrigin;
    } catch (e) {
      return false;
    }
  }
  root.WF_POLICY = { cacheablePage: cacheablePage };
})(typeof self !== "undefined" ? self : globalThis);
