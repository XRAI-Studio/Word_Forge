/* Word Forge saved-progress writer. Loaded by index.html with a plain <script> before the
 * game script (it sets self.WF_PROGRESS) and imported by tests/progress-store.test.mjs, so it
 * must be plain script with no exports, like sw-policy.js.
 *
 * Every save writes the full snapshot. A failed write (localStorage throws outright in some
 * privacy modes, or when the quota is full) marks progress as unsaved; the next save retries
 * the whole snapshot and clears the mark when it succeeds. The Home Room button reads the
 * mark to warn the learner before they leave.
 */
(function (root) {
  /**
   * @param {() => Storage} getStorage called on every save, because even reading
   *   `localStorage` can throw.
   * @param {string} key
   */
  function createProgressSaver(getStorage, key) {
    var unsaved = false;
    return {
      /** Writes the snapshot; returns true when the write succeeded. */
      save: function (snapshot) {
        try {
          getStorage().setItem(key, JSON.stringify(snapshot));
          unsaved = false;
          return true;
        } catch (e) {
          unsaved = true;
          return false;
        }
      },
      /** True while the last write failed. */
      unsaved: function () {
        return unsaved;
      },
    };
  }
  root.WF_PROGRESS = { createProgressSaver: createProgressSaver };
})(typeof self !== "undefined" ? self : globalThis);
