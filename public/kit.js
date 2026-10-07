// Portal kit for Word Forge (class standard rule 3). index.html loads
// https://class.travelschooling.com/kit/v1/ts-kit.js first; this module wraps TSKit.init,
// provides a no-op mock on localhost so `npm run dev` works without a portal session, and
// guards every award against an account switch under an open tab (the real kit captures
// the learner's token once at init). Same module as Katas' kit.js minus the step tracker.

export const GAME = 'wordforge';
const DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isDevHost(hostname) {
  return DEV_HOSTS.has(hostname);
}

const EMPTY_AWARD = { awarded_xp: 0, xp: 0, gems: 0, level: 1, streak: 0, level_up: false, new_achievements: [] };

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * A kit that records awards on window.__kitAwards and saves on window.__kitSaves instead of
 * calling the portal. It keeps one stored state in memory (load returns `{}` until a save),
 * and drops a save whose rev is lower than the stored one, as `save_progress` does.
 * `win.__kitLoadGate` (e2e): a promise every load waits for, to hold the first load open.
 */
export function mockKit(win) {
  const awards = (win.__kitAwards = win.__kitAwards || []);
  const saves = (win.__kitSaves = win.__kitSaves || []);
  let stored = null;
  const revOf = (state) => (state && typeof state.rev === 'number' ? state.rev : 0);
  return {
    mock: true,
    user: { id: 'dev', displayName: 'Dev Learner', role: 'student' },
    totals: { xp: 0, gems: 0, level: 1, streak: 0 },
    launcherUrl: 'https://class.travelschooling.com',
    load: async () => {
      if (win.__kitLoadGate) await win.__kitLoadGate;
      return stored ? clone(stored) : {};
    },
    save: async (state, summary = {}) => {
      saves.push(clone({ state, summary }));
      if (!stored || revOf(state) >= revOf(stored)) stored = clone(state);
    },
    award: async (event, detail = {}) => {
      awards.push({ event, detail });
      return { ...EMPTY_AWARD };
    },
    unlock: async () => ({}),
    toast: () => undefined,
  };
}

/**
 * Resolves to { kind: 'ready', kit } | { kind: 'redirecting' } | { kind: 'unavailable' }.
 * 'redirecting': the real kit found no session and has already started navigating to
 * the portal login. 'unavailable': the kit script did not load.
 *
 * The start-up is tracked with the in-flight awards (see flushAwards): the kit may send
 * work of its own while it starts, so the Home Room button waits for it too, under the
 * same deadline.
 */
export function initKit(opts) {
  const starting = startKit(opts);
  track(starting.catch(() => undefined));
  return starting;
}

async function startKit({ hostname = location.hostname, TSKit = globalThis.TSKit, win = globalThis } = {}) {
  if (isDevHost(hostname)) return { kind: 'ready', kit: mockKit(win) };
  if (!TSKit || typeof TSKit.init !== 'function') return { kind: 'unavailable' };
  const kit = await TSKit.init({ game: GAME });
  if (!kit || !kit.user) return { kind: 'redirecting' };
  return { kind: 'ready', kit };
}

// ---- session identity, read the way the kit reads it (no verification) ----

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The `sub` claim of the portal session cookie's access token, or null. */
export function sessionUserId(cookieHeader) {
  if (!cookieHeader) return null;
  const chunks = [];
  for (const part of cookieHeader.split(/;\s*/)) {
    const m = part.match(/^(sb-[^=]*-auth-token(?:\.(\d+))?)=(.*)$/);
    if (m) chunks.push({ idx: m[2] ? parseInt(m[2], 10) : 0, val: m[3] });
  }
  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.idx - b.idx);
  try {
    let raw = decodeURIComponent(chunks.map((c) => c.val).join(''));
    if (raw.startsWith('base64-')) raw = b64urlDecode(raw.slice(7));
    const token = JSON.parse(raw).access_token;
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const sub = JSON.parse(b64urlDecode(parts[1])).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

/** True when the browser's current session still belongs to the learner the kit started with. */
export function sameAccount(kit, cookieHeader) {
  if (kit.mock) return true;
  return sessionUserId(cookieHeader) === kit.user.id;
}

// Awards that have been sent and not yet answered, and the kit's start-up while it runs.
// The Home Room button waits for them (bounded) so work in flight just before leaving is
// not dropped by the navigation.
const pendingAwards = new Set();

/** Tracks a never-rejecting promise until it settles. */
function track(promise) {
  const tracked = promise.finally(() => pendingAwards.delete(tracked));
  pendingAwards.add(tracked);
  return tracked;
}

/**
 * Tracks any promise (a rejection counts as settled) so flushAwards waits for it; returns
 * `promise` unchanged. index.html tracks its whole start-up with it (R007).
 */
export function trackPending(promise) {
  track(Promise.resolve(promise).then(() => undefined, () => undefined));
  return promise;
}

/** How many awards are still in flight. */
export function pendingAwardCount() {
  return pendingAwards.size;
}

/**
 * Resolves true once the pending set is empty, or false when `timeoutMs` passes first.
 * An award can start during the wait (a correct answer just before the press), so it drains
 * successive snapshots of the set until none is left, all under the one deadline. Never
 * rejects. Resolves at once when nothing is in flight.
 */
export function flushAwards(timeoutMs = 2000) {
  if (pendingAwards.size === 0) return Promise.resolve(true);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const drained = (async () => {
    // Each tracked promise removes itself before it settles, so this loop never spins.
    while (pendingAwards.size > 0) await Promise.allSettled([...pendingAwards]);
    return true;
  })();
  return Promise.race([drained, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Fire-and-forget award, refused when the signed-in account changed under this tab
 * (the kit would credit the previous learner). `onMismatch` lets the page reload through
 * the gate so the kit starts fresh. The portal caps XP per event and per day, so a lost
 * call costs nothing. The call is tracked until it settles (see flushAwards).
 */
export function award(kit, event, detail, { cookie = () => document.cookie, onMismatch = () => {} } = {}) {
  if (!sameAccount(kit, cookie())) {
    onMismatch();
    return false;
  }
  track(
    Promise.resolve()
      .then(() => kit.award(event, detail))
      .catch((err) => console.warn(`[kit] award ${event} failed:`, err && err.message ? err.message : err)),
  );
  return true;
}

export const RESTART_TEXT = 'The signed-in account changed. Reloading…';
export const RESTART_LOSS_TEXT = 'The signed-in account changed. Reloading… Your unfinished word will not be kept.';
export const RESTART_STALLED_TEXT = 'The signed-in account changed. Reload to keep playing.';

/**
 * Reload through the gate after the signed-in account changed under this tab. Awards stay
 * refused from the first call on (isRestarting), since the kit holds the old learner.
 *
 * The page's own leave prompt must not stop this reload, so `allowUnload(true)` releases it
 * first; it returns whether unsaved work will be lost, and the banner says so. If the page is
 * still here after `stallMs` (the reload was cancelled or blocked), the prompt is restored
 * (`allowUnload(false)`) and the banner offers a Reload control that runs the restart again.
 *
 * `showBanner(text, action)`: `action`, when given, is the Reload control's handler.
 */
export function accountChangeRestart({ reload, showBanner, allowUnload = () => false, schedule = setTimeout, stallMs = 3000 }) {
  let state = 'idle'; // 'idle' | 'reloading' | 'stalled'
  let attempt = 0;
  function run() {
    if (state === 'reloading') return;
    state = 'reloading';
    const mine = ++attempt;
    const losing = allowUnload(true);
    showBanner(losing ? RESTART_LOSS_TEXT : RESTART_TEXT, null);
    reload();
    schedule(() => {
      if (state !== 'reloading' || mine !== attempt) return;
      state = 'stalled';
      allowUnload(false);
      showBanner(RESTART_STALLED_TEXT, run);
    }, stallMs);
  }
  return { run, isRestarting: () => state !== 'idle' };
}

// ---- launcher tile: "<n> words forged · <s> of <N> stories" (work order 2026-09-30) ----

const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** The tile summary for the game's `{ storiesUnlocked, correctTotal }`. */
export function progressSummary({ storiesUnlocked, correctTotal }, storyCount) {
  const n = count(correctTotal);
  const s = Math.min(count(storiesUnlocked), storyCount);
  return {
    headline: `${n} ${n === 1 ? 'word' : 'words'} forged · ${s} of ${storyCount} stories`,
    percent: storyCount > 0 ? Math.round((100 * s) / storyCount) : 0,
  };
}

// ---- cross-device sync (Plan 3): correct answers per page session; the total is the sum ----

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/**
 * Object.fromEntries defines own data properties, so "__proto__" or "constructor" are
 * ordinary keys; every read goes through own(), never through the prototype (CDS3-008).
 */
const counterObject = (entries) => Object.fromEntries(entries);

/**
 * Read Words' synced state `{ v: 2, correct: { [bucket]: n } }`, keys sorted. A v1 record
 * (`{ correctTotal, storiesUnlocked, rev }`) becomes the shared `legacy` bucket; anything
 * else is empty. Counts are non-negative integers; other values are dropped.
 */
export function syncState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.v === 2 && r.correct && typeof r.correct === 'object' && !Array.isArray(r.correct)) {
    const c = r.correct;
    return {
      v: 2,
      correct: counterObject(Object.keys(c).sort().flatMap((k) => {
        const n = own(c, k) ? c[k] : undefined;
        return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? [[k, Math.floor(n)]] : [];
      })),
    };
  }
  const legacy = count(r.correctTotal);
  return { v: 2, correct: counterObject(legacy > 0 ? [['legacy', legacy]] : []) };
}

/** Per-bucket max, keys sorted: idempotent, commutative and associative; never reads the clock. */
export function mergeSync(a, b) {
  const x = syncState(a).correct;
  const y = syncState(b).correct;
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  return { v: 2, correct: counterObject(keys.map((k) => [k, Math.max(own(x, k) ? x[k] : 0, own(y, k) ? y[k] : 0)])) };
}

/** Correct answers across every bucket. */
export function syncTotal(s) {
  return Object.values(syncState(s).correct).reduce((t, n) => t + n, 0);
}

/** One story per three correct answers, capped at the story count. */
export function storiesFor(total, storyCount) {
  return Math.min(storyCount, Math.floor(count(total) / 3));
}

/** The tile summary of a synced state. */
export function syncSummary(s, storyCount) {
  const total = syncTotal(s);
  return progressSummary({ correctTotal: total, storiesUnlocked: storiesFor(total, storyCount) }, storyCount);
}

/**
 * Field-wise max of two progress records (both are cross-device high-water marks, not
 * sums). Non-numeric values count as 0; stories are capped at `storyCount`.
 */
export function mergeProgress(local, server, storyCount = Infinity) {
  const l = local || {};
  const r = server || {};
  return {
    storiesUnlocked: Math.min(storyCount, Math.max(count(l.storiesUnlocked), count(r.storiesUnlocked))),
    correctTotal: Math.max(count(l.correctTotal), count(r.correctTotal)),
  };
}

/**
 * One serialized publisher (never calls `publish` while an earlier call is unsettled, so
 * the real kit's debounce, which cancels the earlier timer without settling its promise,
 * never strands one): `request(snapshot)` keeps the newest snapshot and starts a run if
 * none is going; a run publishes, then repeats only if a newer snapshot arrived meanwhile.
 * Only the run is tracked (see flushAwards); it never rejects. `request` resolves when a
 * run that included the snapshot has finished.
 */
export function createPublisher(publish, { track: trackRun = trackPending } = {}) {
  let latest;
  let waiting = false;
  let running = null;
  function run() {
    return (async () => {
      try {
        while (waiting) {
          const snapshot = latest;
          waiting = false;
          latest = undefined;
          try {
            await publish(snapshot);
          } catch (err) {
            console.warn('[kit] save failed:', err && err.message ? err.message : err);
          }
        }
      } finally {
        running = null; // same turn as the loop's last check: a later request starts a new run
      }
    })();
  }
  return {
    request(snapshot) {
      latest = snapshot;
      waiting = true;
      if (!running) running = trackRun(run());
      return running;
    },
    busy: () => running !== null,
  };
}

/**
 * The server copy of the game's progress, for the launcher tile and a cross-device
 * max-merge. `hook` is the game's `window.__wfProgress` ({ learner, storyCount, get, set }).
 * `start()` (inside the tracked start-up): the first `kit.load()`, a max-merge into the
 * game's in-memory counts (which already include answers made while the kit started),
 * stored through `hook.set`, then one publish, so existing progress reaches the tile with
 * no play. `publish(snapshot)` (the game's saveProgress) goes to the publisher once that
 * start-up publish has begun; before it, the start-up reads the game's counts itself.
 * Saves carry `rev = correctTotal` (storiesUnlocked follows from it), so a device with
 * fewer answers never overwrites a higher server copy. Refused under an account switch,
 * like `award`.
 */
export function progressSync(kit, hook, { cookie = () => document.cookie, onMismatch = () => {}, isRestarting = () => false, track: trackRun = trackPending } = {}) {
  let open = false;
  const publisher = createPublisher(async (snapshot) => {
    if (isRestarting()) return;
    if (!sameAccount(kit, cookie())) {
      onMismatch();
      return;
    }
    const p = mergeProgress(snapshot, null, hook.storyCount);
    await kit.save({ rev: p.correctTotal, storiesUnlocked: p.storiesUnlocked, correctTotal: p.correctTotal }, progressSummary(p, hook.storyCount));
  }, { track: trackRun });
  return {
    async start() {
      // The page's learner (read from the cookie at load) must be the kit's learner.
      if (!kit.mock && hook.learner !== kit.user.id) {
        onMismatch();
        return;
      }
      let server = {};
      try {
        server = await kit.load();
      } catch {
        // publish the in-memory counts only
      }
      const merged = mergeProgress(hook.get(), server, hook.storyCount);
      hook.set(merged);
      open = true;
      if (merged.correctTotal > 0 || merged.storiesUnlocked > 0) await publisher.request(hook.get());
    },
    publish(snapshot) {
      if (open) publisher.request(snapshot);
    },
  };
}
