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
 */
export async function initKit({ hostname = location.hostname, TSKit = globalThis.TSKit, win = globalThis } = {}) {
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

/**
 * Fire-and-forget award, refused when the signed-in account changed under this tab
 * (the kit would credit the previous learner). `onMismatch` lets the page reload through
 * the gate so the kit starts fresh. The portal caps XP per event and per day, so a lost
 * call costs nothing.
 */
export function award(kit, event, detail, { cookie = () => document.cookie, onMismatch = () => {} } = {}) {
  if (!sameAccount(kit, cookie())) {
    onMismatch();
    return false;
  }
  Promise.resolve()
    .then(() => kit.award(event, detail))
    .catch((err) => console.warn(`[kit] award ${event} failed:`, err && err.message ? err.message : err));
  return true;
}
