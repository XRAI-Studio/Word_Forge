/* Word Forge saved-progress writer. Loaded by index.html with a plain <script> before the
 * game script (it sets self.WF_PROGRESS) and imported by tests/progress-store.test.mjs, so it
 * must be plain script with no exports, like sw-policy.js.
 *
 * Every save writes the full snapshot. A failed write (localStorage throws outright in some
 * privacy modes, or when the quota is full) marks progress as unsaved; the next save retries
 * the whole snapshot and clears the mark when it succeeds. The Home Room button reads the
 * mark to warn the learner before they leave.
 *
 * Progress is per learner (work order 2026-09-30, R001): the key is
 * `wordforge:progress:<userId>`, where the id is the session cookie's `sub` (read here the
 * way kit.js's sessionUserId reads it, since the game script is a classic script that
 * needs it synchronously at page load; tests/progress-store.test.mjs checks the two agree)
 * or `dev` on localhost. The unscoped `wordforge:progress` from before is claimed once, by
 * the first learner who opens the game on this browser, then removed.
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
      /**
       * Writes the snapshot; returns true when the write succeeded. With no key (no learner
       * id) nothing is written: any progress then exists only in memory, which counts as
       * unsaved so the leave warning still shows (Codex WF-002).
       */
      save: function (snapshot) {
        if (!key) {
          unsaved = !!(snapshot && (snapshot.correctTotal > 0 || snapshot.storiesUnlocked > 0));
          return !unsaved;
        }
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

  var LEGACY_KEY = "wordforge:progress";
  /** Who claimed the legacy record: `<userId>` while the claim is under way, `done:<userId>` after. */
  var CLAIM_KEY = "wordforge:progress-legacy-claim";
  var DEV_HOSTS = ["localhost", "127.0.0.1"];

  function b64urlDecode(s) {
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    return new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }));
  }

  /** The `sub` claim of the portal session cookie's access token, or null (same reading as kit.js). */
  function sessionUserId(cookieHeader) {
    if (!cookieHeader) return null;
    var chunks = [];
    var parts = cookieHeader.split(/;\s*/);
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^(sb-[^=]*-auth-token(?:\.(\d+))?)=(.*)$/);
      if (m) chunks.push({ idx: m[2] ? parseInt(m[2], 10) : 0, val: m[3] });
    }
    if (chunks.length === 0) return null;
    chunks.sort(function (a, b) { return a.idx - b.idx; });
    try {
      var raw = decodeURIComponent(chunks.map(function (c) { return c.val; }).join(""));
      if (raw.indexOf("base64-") === 0) raw = b64urlDecode(raw.slice(7));
      var token = JSON.parse(raw).access_token;
      if (typeof token !== "string") return null;
      var segs = token.split(".");
      if (segs.length < 2) return null;
      var sub = JSON.parse(b64urlDecode(segs[1])).sub;
      return typeof sub === "string" && sub ? sub : null;
    } catch (e) {
      return null;
    }
  }

  /** Whose progress this page load keeps: `dev` on localhost (the mock kit's user), else the cookie's `sub`, else null. */
  function learnerId(cookieHeader, hostname) {
    if (DEV_HOSTS.indexOf(hostname) >= 0) return "dev";
    return sessionUserId(cookieHeader);
  }

  function progressKey(userId) {
    return LEGACY_KEY + ":" + userId;
  }

  /** A stored record, sanitised as the game always has; null when absent, zeros when unreadable. */
  function readRecord(storage, key, storyCount) {
    var raw = storage.getItem(key);
    if (!raw) return null;
    try {
      var saved = JSON.parse(raw) || {};
      return {
        storiesUnlocked: Math.max(0, Math.min(storyCount, saved.storiesUnlocked | 0)),
        correctTotal: Math.max(0, saved.correctTotal | 0),
      };
    } catch (e) {
      return { storiesUnlocked: 0, correctTotal: 0 };
    }
  }

  /**
   * The learner's saved progress at page load. The legacy unscoped record belongs to exactly
   * one learner (Codex WF-001): a durable claim marker is written **before** anything is
   * imported, and only its owner may import. The legacy counts are merged (field-wise max)
   * and used only once the claim and the learner's scoped copy are both stored; then the
   * marker becomes `done:<owner>` and the legacy key is removed. A failed write imports
   * nothing (the owner retries on a later load; nobody else can). After `done`, a legacy key
   * recreated by a page opened before this change is removed unread, whoever sees it.
   * No learner id: nothing is read (progress stays in memory only).
   */
  function loadLearnerProgress(getStorage, userId, storyCount) {
    var progress = { storiesUnlocked: 0, correctTotal: 0 };
    if (!userId) return progress;
    try {
      var storage = getStorage();
      var key = progressKey(userId);
      var scoped = readRecord(storage, key, storyCount);
      if (scoped) progress = scoped;
      var legacy = readRecord(storage, LEGACY_KEY, storyCount);
      if (!legacy) return progress;
      var claim = storage.getItem(CLAIM_KEY);
      if (claim && claim.indexOf("done:") === 0) {
        try { storage.removeItem(LEGACY_KEY); } catch (e) {}
        return progress;
      }
      if (claim && claim !== userId) return progress; // another learner's claim is under way
      var merged = {
        storiesUnlocked: Math.max(progress.storiesUnlocked, legacy.storiesUnlocked),
        correctTotal: Math.max(progress.correctTotal, legacy.correctTotal),
      };
      try {
        storage.setItem(CLAIM_KEY, userId);
        storage.setItem(key, JSON.stringify(merged));
      } catch (e) {
        return progress; // not durably owned yet: import nothing
      }
      progress = merged;
      try {
        storage.setItem(CLAIM_KEY, "done:" + userId);
        storage.removeItem(LEGACY_KEY);
      } catch (e) {
        // the scoped copy holds the merge; the owner's next load finishes the claim
      }
    } catch (e) {
      // localStorage unavailable: start from zero, as before
    }
    return progress;
  }

  root.WF_PROGRESS = {
    createProgressSaver: createProgressSaver,
    sessionUserId: sessionUserId,
    learnerId: learnerId,
    progressKey: progressKey,
    loadLearnerProgress: loadLearnerProgress,
    LEGACY_KEY: LEGACY_KEY,
    CLAIM_KEY: CLAIM_KEY,
  };
})(typeof self !== "undefined" ? self : globalThis);
