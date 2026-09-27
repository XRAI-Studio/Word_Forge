/* Word Forge leave guard for the Return to Home Room button. Loaded by index.html with a
 * plain <script> before the game script (it sets self.WF_LEAVE) and imported by
 * tests/leave-guard.test.mjs, so it must be plain script with no exports, like sw-policy.js.
 *
 * - While the game reports unsaved work, a beforeunload listener is armed so the browser
 *   shows its own leave prompt; it is removed as soon as there is none (call sync()).
 * - request() is the button: unsaved work opens the in-page dialog; otherwise a clean
 *   departure. A second press during a departure is ignored.
 * - A clean departure disables the game's controls (setBusy) while awards flush (the caller
 *   bounds the flush), then checks again: if work became unsaved meanwhile (a new word, a
 *   failed progress write) it cancels, re-enables the controls and opens the dialog.
 * - discard() is "Leave without saving": an explicit discard, so the prompt is removed first
 *   and it navigates whatever is unsaved.
 * - allowUnload(true) lets a reload the page itself ordered (account change) go through
 *   without the prompt; allowUnload(false) restores the protection.
 * - The departure latch covers one attempt only: if the document is still here `stallMs`
 *   after navigate() (the learner pressed Stop, or the navigation failed), the attempt is
 *   over: the controls come back and the prompt is re-evaluated. Timers of older attempts
 *   are ignored.
 * - A page restored from the back/forward cache (pageshow with persisted) is a live page
 *   again: the departure resets, the controls come back and the prompt is re-evaluated.
 */
(function (root) {
  function noop() {}

  function createLeaveGuard(opts) {
    var win = opts.win;
    var hasUnsavedWork = opts.hasUnsavedWork;
    var setBusy = opts.setBusy || noop;
    var schedule = opts.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var stallMs = opts.stallMs == null ? 3000 : opts.stallMs;
    var attempt = 0; // bumps on every departure and restore; a timer acts only for its own
    var armed = false;
    var departing = false; // a departure (clean or discard) is under way
    var discarding = false; // "Leave without saving": the prompt stays off
    var released = false; // allowUnload(true)

    function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }

    function sync() {
      var want = !discarding && !released && !!hasUnsavedWork();
      if (want === armed) return;
      armed = want;
      if (want) win.addEventListener("beforeunload", onBeforeUnload);
      else win.removeEventListener("beforeunload", onBeforeUnload);
    }

    function flushed() {
      return Promise.resolve().then(opts.flush).catch(noop);
    }

    /** Ends the departure attempt: the page stays, so it is a live page again. */
    function endDeparture() {
      attempt++;
      departing = false;
      discarding = false;
      setBusy(false);
      sync();
    }

    /** Navigates, and ends this attempt if the document is still here after stallMs. */
    function go(mine) {
      opts.navigate();
      schedule(function () {
        if (mine === attempt && departing) endDeparture();
      }, stallMs);
      return true;
    }

    /** Clean departure. Resolves true when it navigated, false when it was cancelled. */
    function depart() {
      if (departing) return Promise.resolve(false);
      departing = true;
      var mine = ++attempt;
      setBusy(true);
      return flushed().then(function () {
        if (mine !== attempt) return false; // restored meanwhile
        if (hasUnsavedWork()) {
          endDeparture();
          opts.openDialog();
          return false;
        }
        return go(mine);
      });
    }

    /** "Leave without saving". Resolves true when it navigated, false when already leaving. */
    function discard() {
      if (departing) return Promise.resolve(false);
      departing = true;
      discarding = true;
      var mine = ++attempt;
      sync();
      setBusy(true);
      return flushed().then(function () {
        if (mine !== attempt) return false; // restored meanwhile
        return go(mine);
      });
    }

    /** The button press. Resolves true when it navigated. */
    function request() {
      if (departing) return Promise.resolve(false);
      if (opts.beforeRequest) opts.beforeRequest();
      if (hasUnsavedWork()) {
        opts.openDialog();
        return Promise.resolve(false);
      }
      return depart();
    }

    function allowUnload(on) {
      released = !!on;
      sync();
    }

    win.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      endDeparture();
    });

    return {
      sync: sync,
      request: request,
      discard: discard,
      allowUnload: allowUnload,
      isArmed: function () {
        return armed;
      },
      isDeparting: function () {
        return departing;
      },
    };
  }
  root.WF_LEAVE = { createLeaveGuard: createLeaveGuard };
})(typeof self !== "undefined" ? self : globalThis);
