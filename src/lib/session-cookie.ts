/**
 * Reads the portal's Supabase session cookie the way the game kit does. Shared by
 * the API routes (which then verify the token) and by the browser, which only needs
 * to notice that the signed-in account changed under an open tab. Nothing here
 * verifies anything.
 */

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Joins numbered `sb-<ref>-auth-token` chunks, url-decodes, strips a `base64-` prefix, parses JSON. */
export function extractAccessToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const chunks: Array<{ idx: number; val: string }> = [];
  for (const part of cookieHeader.split(/;\s*/)) {
    const m = part.match(/^(sb-[^=]*-auth-token(?:\.(\d+))?)=(.*)$/);
    if (m) chunks.push({ idx: m[2] ? parseInt(m[2], 10) : 0, val: m[3] });
  }
  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.idx - b.idx);
  try {
    let raw = decodeURIComponent(chunks.map((c) => c.val).join(""));
    if (raw.startsWith("base64-")) raw = b64urlDecode(raw.slice(7));
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    return typeof parsed.access_token === "string" && parsed.access_token ? parsed.access_token : null;
  } catch {
    return null;
  }
}

/** The `sub` claim of the session's access token, read without verification. */
export function sessionUserId(cookieHeader: string | null): string | null {
  const token = extractAccessToken(cookieHeader);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1])) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
