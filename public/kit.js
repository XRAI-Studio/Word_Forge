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

/** A kit that records awards on window.__kitAwards instead of calling the portal. */
export function mockKit(win) {
  const awards = (win.__kitAwards = win.__kitAwards || []);
  return {
    mock: true,
    user: { id: 'dev', displayName: 'Dev Learner', role: 'student' },
    totals: { xp: 0, gems: 0, level: 1, streak: 0 },
    launcherUrl: 'https://class.travelschooling.com',
    load: async () => ({}),
    save: async () => undefined,
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
