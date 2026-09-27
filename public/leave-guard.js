/* Word Forge leave guard for the Return to Home Room button. Loaded by index.html with a
 * plain <script> before the game script (it sets self.WF_LEAVE) and imported by
 * tests/leave-guard.test.mjs, so it must be plain script with no exports, like sw-policy.js.
 *
 * - While the game reports unsaved work, a beforeunload listener is armed so the browser
 *   shows its own leave prompt; it is removed as soon as there is none (call sync()).
 * - request() is the button: unsaved work opens the in-page dialog; otherwise it leaves.
 * - leave() departs without asking: it disarms the prompt, waits for the flush (the caller
 *   bounds it) and navigates. A second press during a departure is ignored.
 * - A page restored from the back/forward cache (pageshow with persisted) is a live page
 *   again: the departure latch resets and the prompt is re-evaluated.
 */
(function (root) {
  function createLeaveGuard(opts) {
    var win = opts.win;
    var hasUnsavedWork = opts.hasUnsavedWork;
    var armed = false;
    var leaving = false;

    function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }

    function sync() {
      var want = !leaving && !!hasUnsavedWork();
      if (want === armed) return;
      armed = want;
      if (want) win.addEventListener("beforeunload", onBeforeUnload);
      else win.removeEventListener("beforeunload", onBeforeUnload);
    }

    /** Leaves without asking. Resolves true when it navigated, false when already leaving. */
    function leave() {
      if (leaving) return Promise.resolve(false);
      leaving = true;
      sync();
      return Promise.resolve()
        .then(opts.flush)
        .catch(function () {})
        .then(function () {
          opts.navigate();
          return true;
        });
    }

    /** The button press. Resolves true when it navigated. */
    function request() {
      if (leaving) return Promise.resolve(false);
      if (opts.beforeRequest) opts.beforeRequest();
      if (hasUnsavedWork()) {
        opts.openDialog();
        return Promise.resolve(false);
      }
      return leave();
    }

    win.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      leaving = false;
      sync();
    });

    return {
      sync: sync,
      request: request,
      leave: leave,
      isArmed: function () {
        return armed;
      },
      isLeaving: function () {
        return leaving;
      },
    };
  }
  root.WF_LEAVE = { createLeaveGuard: createLeaveGuard };
})(typeof self !== "undefined" ? self : globalThis);
