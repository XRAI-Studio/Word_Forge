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

  // ---- cross-device sync (Plan 3): the synced state, one storage entry per page session ----
  //
  // The synced state is `{ v: 2, correct: { [bucket]: n } }` (kit.js has the same algebra as
  // ES module exports; tests/progress-store.test.mjs checks the two agree). Each page session
  // counts its correct answers in its own bucket "s.<session>" and writes only its own entry
  // `wordforge:sync:<learner>:<session>`, synchronously with every answer, so no two tabs ever
  // write the same key (CDS3-001, CDS3-009). At load every entry of the learner is merged.
  // The first time a learner has no entry at all, the old aggregate total is written once as
  // the `:legacy` baseline (CDS3-013); after that the aggregate is never read again. Once the
  // server has acknowledged a state, a session removes the entries of lower-sorted sessions
  // that state holds, after writing and reading back its own (CDS3-015).

  var SYNC_PREFIX = "wordforge:sync:";
  var LEGACY_SESSION = "legacy";

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
  /** True when the two states are the same once normalized. */
  function sameSync(a, b) {
    return JSON.stringify(syncState(a)) === JSON.stringify(syncState(b));
  }
  /** True when `big` holds everything in `small`. */
  function containsSync(big, small) {
    return sameSync(mergeSync(big, small), big);
  }

  function syncKey(learner, session) {
    return SYNC_PREFIX + learner + ":" + session;
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

  /**
   * The learner's synced state at page load: the merge of every `wordforge:sync:<learner>:*`
   * entry. With no entry at all, `legacyTotal` (the old aggregate's total) is written once as
   * the `:legacy` baseline, even when 0, so it is never imported again (CDS3-013). No learner:
   * nothing is read or written. Unreadable storage: the baseline, in memory only.
   */
  function loadSync(getStorage, learner, legacyTotal) {
    if (!learner) return syncState(null);
    var baseline = syncState({ correctTotal: legacyTotal });
    try {
      var storage = getStorage();
      var keys = syncKeys(storage, learner);
      if (keys.length === 0) {
        try { storage.setItem(syncKey(learner, LEGACY_SESSION), JSON.stringify(baseline)); } catch (e) {}
        return baseline;
      }
      var state = syncState(null);
      keys.forEach(function (k) {
        var e = parseEntry(storage.getItem(k));
        if (e) state = mergeSync(state, e);
      });
      return state;
    } catch (e) {
      return baseline;
    }
  }

  /**
   * Writes this session's entry only; true when it was written. No learner: nothing is
   * written, and a non-empty state then exists only in memory, which is unsaved.
   */
  function saveSync(getStorage, learner, session, state) {
    if (!learner) return syncTotal(state) === 0;
    try {
      getStorage().setItem(syncKey(learner, session), JSON.stringify(syncState(state)));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * After the server acknowledged `ack` (CDS3-015): writes this session's entry with
   * merge(current, ack) and reads it back; only when that succeeded, removes each entry of a
   * session whose id sorts lower than this one (so two tabs never remove each other's, and
   * the highest session's entry always survives), that `ack` and the read-back entry both
   * hold, and that is unchanged on an immediate re-read. The legacy baseline is never
   * removed. Returns { written, state, removed }.
   */
  function cleanupSync(getStorage, learner, session, ack, current) {
    var result = { written: false, state: mergeSync(current, ack), removed: [] };
    if (!learner) return result;
    try {
      var storage = getStorage();
      var ownKey = syncKey(learner, session);
      storage.setItem(ownKey, JSON.stringify(result.state));
      var back = parseEntry(storage.getItem(ownKey));
      if (!back || !sameSync(back, result.state)) return result;
      result.written = true;
      var prefix = SYNC_PREFIX + learner + ":";
      syncKeys(storage, learner).forEach(function (k) {
        var sid = k.slice(prefix.length);
        if (sid === session || sid === LEGACY_SESSION || !(sid < session)) return;
        var raw = storage.getItem(k);
        var e = parseEntry(raw);
        if (!e || !containsSync(ack, e) || !containsSync(back, e)) return;
        if (storage.getItem(k) !== raw) return;
        storage.removeItem(k);
        result.removed.push(k);
      });
    } catch (e) {
      // storage unavailable: nothing more is removed
    }
    return result;
  }

  /**
   * One page session's synced progress: `state` (loaded at creation), the bucket
   * "s.<session>", and the unsaved status the leave guard reads (CDS3-012): set when writing
   * the session's entry fails, cleared when a later write of it succeeds or by clearUnsaved()
   * (a server acknowledgement that contains the current state, decided by kit.js).
   */
  function createSyncSession(opts) {
    var getStorage = opts.getStorage, learner = opts.learner, session = opts.session;
    var bucket = "s." + session;
    var state = loadSync(getStorage, learner, opts.legacyTotal);
    var unsaved = false;
    function write() {
      var ok = saveSync(getStorage, learner, session, state);
      unsaved = !ok;
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
      /** The server holds `ack`: write this entry, then clean up (cleanupSync). */
      acknowledged: function (ack) {
        var r = cleanupSync(getStorage, learner, session, ack, state);
        state = r.state;
        if (r.written) unsaved = false;
        return r;
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
    cleanupSync: cleanupSync,
    createSyncSession: createSyncSession,
  };
})(typeof self !== "undefined" ? self : globalThis);
