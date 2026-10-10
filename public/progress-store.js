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

  // ---- cross-device sync (Plan 3): the synced state, kept in storage entries per learner ----
  //
  // The synced state is `{ v: 2, correct: { [bucket]: n } }` (kit.js has the same algebra as
  // ES module exports; tests/progress-store.test.mjs checks the two agree). Each page session
  // counts its correct answers in its own bucket "s.<session>". Storage, per learner
  // (`wordforge:sync:<learner>:<name>`):
  //   <session> - that session's own bucket only, `{ v: 2, correct: { "s.<session>": n } }`,
  //     written by that session alone, synchronously with every answer, and never removed by
  //     anyone (Codex WF-CDS3-002: no cross-session cleanup, so no read-then-remove race).
  //     Accepted cost: one tiny entry per page session that answered, kept for good.
  //   known   - shared, best effort: any session merges its whole state into it (the other
  //     device's work it adopted included; read-merge-write, see saveKnown). It holds only
  //     what the server or the session entries also hold, so a lost race there costs
  //     nothing permanent.
  //   legacy  - the old aggregate total, imported as the `legacy` bucket (CDS3-013). The
  //     import is done only once this entry exists; until then every load tries again, and
  //     it is written as the max of its current value and the claimed aggregate, so a retry
  //     never counts twice (WF-CDS3-003). The game no longer writes the old aggregate, so it
  //     never carries v2 answers.
  // At load the state is the merge of all of them. The unsaved status the leave guard reads
  // is driven by the session's own entry write (CDS3-012).

  var SYNC_PREFIX = "wordforge:sync:";
  var LEGACY_ENTRY = "legacy";
  var KNOWN_ENTRY = "known";

  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function count(v) {
    return typeof v === "number" && isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  }
  /** Same as kit.js syncState: v1 becomes the `legacy` bucket, junk is empty, keys sorted. */
  function syncState(raw) {
    var r = raw && typeof raw === "object" ? raw : {};
    if (r.v === 2 && r.correct && typeof r.correct === "object" && !Array.isArray(r.correct)) {
      var c = r.correct;
      var entries = [];
      Object.keys(c).sort().forEach(function (k) {
        var n = own(c, k) ? c[k] : undefined;
        if (typeof n === "number" && isFinite(n) && n >= 0) entries.push([k, Math.floor(n)]);
      });
      return { v: 2, correct: Object.fromEntries(entries) };
    }
    var legacy = count(r.correctTotal);
    return { v: 2, correct: Object.fromEntries(legacy > 0 ? [["legacy", legacy]] : []) };
  }
  /** Same as kit.js mergeSync: per-bucket max, keys sorted. */
  function mergeSync(a, b) {
    var x = syncState(a).correct, y = syncState(b).correct;
    var keys = Object.keys(x).concat(Object.keys(y).filter(function (k) { return !own(x, k); })).sort();
    return { v: 2, correct: Object.fromEntries(keys.map(function (k) {
      return [k, Math.max(own(x, k) ? x[k] : 0, own(y, k) ? y[k] : 0)];
    })) };
  }
  function syncTotal(s) {
    var c = syncState(s).correct;
    return Object.keys(c).reduce(function (t, k) { return t + c[k]; }, 0);
  }

  function syncKey(learner, name) {
    return SYNC_PREFIX + learner + ":" + name;
  }
  function parseEntry(raw) {
    if (!raw) return null;
    try {
      var v = JSON.parse(raw);
      return v && typeof v === "object" ? v : null;
    } catch (e) {
      return null;
    }
  }
  /** Every sync entry key of this learner (not of a learner whose id merely starts the same). */
  function syncKeys(storage, learner) {
    var prefix = SYNC_PREFIX + learner + ":";
    var keys = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (k && k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf(":") < 0) keys.push(k);
    }
    return keys;
  }
  /** The `legacy` bucket of a state (0 when absent). */
  function legacyOf(state) {
    var c = syncState(state).correct;
    return own(c, "legacy") ? c.legacy : 0;
  }

  /**
   * The learner's synced state at page load: the merge of the `:legacy`, `:known` and every
   * session entry. The legacy import (WF-CDS3-003): while the `:legacy` entry is missing or
   * holds less than `legacyTotal` (the claimed old aggregate's total), it is written as the
   * max of the two; a failed write is retried on the next load. No learner: nothing is read
   * or written. Unreadable storage: the legacy total, in memory only.
   */
  function loadSync(getStorage, learner, legacyTotal) {
    if (!learner) return syncState(null);
    var baseline = syncState({ correctTotal: legacyTotal });
    try {
      var storage = getStorage();
      var legacyKey = syncKey(learner, LEGACY_ENTRY);
      var stored = parseEntry(storage.getItem(legacyKey));
      if (!stored || legacyOf(stored) < legacyOf(baseline)) {
        // The entry's existence marks the import done; a total of 0 is stored as no bucket.
        var legacy = syncState({ correctTotal: Math.max(legacyOf(stored), legacyOf(baseline)) });
        try { storage.setItem(legacyKey, JSON.stringify(legacy)); } catch (e) {}
      }
      var state = baseline;
      syncKeys(storage, learner).forEach(function (k) {
        var e = parseEntry(storage.getItem(k));
        if (e) state = mergeSync(state, e);
      });
      return state;
    } catch (e) {
      return baseline;
    }
  }

  /**
   * Writes this session's entry: its own bucket "s.<session>" of `state`, nothing else.
   * True when it was written. No learner: nothing is written, and a non-empty state then
   * exists only in memory, which is unsaved.
   */
  function saveSync(getStorage, learner, session, state) {
    var c = syncState(state).correct, bucket = "s." + session;
    if (!learner) return syncTotal(state) === 0;
    try {
      var mine = { v: 2, correct: Object.fromEntries(own(c, bucket) ? [[bucket, c[bucket]]] : []) };
      getStorage().setItem(syncKey(learner, session), JSON.stringify(mine));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Best effort: merges `state` into the shared `:known` entry. Read, merge and write are one
   * synchronous step with nothing awaited in between, so a tab that never saw another tab's
   * adopted work keeps it instead of overwriting it (Codex WF-REVIEW-001). Accepted residual:
   * two tabs writing `:known` within the same instant can still drop remote-only buckets
   * from this local cache; those buckets are on the server and return on the next
   * successful load. (Session entries keep only their own bucket: copying the full state
   * into each would grow with the square of the sessions.) True when written.
   */
  function saveKnown(getStorage, learner, state) {
    if (!learner) return false;
    try {
      var storage = getStorage();
      var key = syncKey(learner, KNOWN_ENTRY);
      var merged = mergeSync(parseEntry(storage.getItem(key)), state);
      storage.setItem(key, JSON.stringify(merged));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * One page session's synced progress: `state` (loaded at creation), the bucket
   * "s.<session>", and the unsaved status the leave guard reads (CDS3-012): set when writing
   * the session's own entry fails, cleared when a later write of it succeeds or by
   * clearUnsaved() (a server acknowledgement that contains the current state, decided by
   * kit.js). Every change also refreshes the shared `:known` entry, best effort.
   */
  function createSyncSession(opts) {
    var getStorage = opts.getStorage, learner = opts.learner, session = opts.session;
    var bucket = "s." + session;
    var state = loadSync(getStorage, learner, opts.legacyTotal);
    var unsaved = false;
    function write() {
      var ok = saveSync(getStorage, learner, session, state);
      unsaved = !ok;
      saveKnown(getStorage, learner, state);
      return ok;
    }
    return {
      session: session,
      bucket: bucket,
      getState: function () { return state; },
      /** One more correct answer in this session's bucket, written at once; the new state. */
      addCorrect: function () {
        var n = own(state.correct, bucket) ? state.correct[bucket] : 0;
        state = mergeSync(state, { v: 2, correct: Object.fromEntries([[bucket, n + 1]]) });
        write();
        return state;
      },
      /** Adopts another copy (only ever merges in), written at once; the new state. */
      setState: function (next) {
        state = mergeSync(state, next);
        write();
        return state;
      },
      unsaved: function () { return unsaved; },
      clearUnsaved: function () { unsaved = false; },
      /** Writes the entry again; true when it was written. */
      retry: function () { return write(); },
      /** The server holds `ack`: merge it in and refresh `:known` (best effort). */
      acknowledged: function (ack) {
        state = mergeSync(state, ack);
        saveKnown(getStorage, learner, state);
        return state;
      },
    };
  }

  root.WF_PROGRESS = {
    createProgressSaver: createProgressSaver,
    sessionUserId: sessionUserId,
    learnerId: learnerId,
    progressKey: progressKey,
    loadLearnerProgress: loadLearnerProgress,
    LEGACY_KEY: LEGACY_KEY,
    CLAIM_KEY: CLAIM_KEY,
    SYNC_PREFIX: SYNC_PREFIX,
    syncState: syncState,
    mergeSync: mergeSync,
    syncTotal: syncTotal,
    syncKey: syncKey,
    loadSync: loadSync,
    saveSync: saveSync,
    saveKnown: saveKnown,
    createSyncSession: createSyncSession,
  };
})(typeof self !== "undefined" ? self : globalThis);
