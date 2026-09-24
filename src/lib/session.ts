import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { extractAccessToken } from "@/lib/session-cookie";

export { extractAccessToken };

export type SessionResult =
  | { ok: true; sub: string; approved: true; displayName: string }
  | { ok: false; reason: "missing" | "invalid" | "pending" };

export interface SessionOptions {
  jwks?: JWTVerifyGetKey;
  issuer?: string;
  env?: { NEXT_PUBLIC_TS_KIT?: string; NODE_ENV?: string; NEXT_PUBLIC_SUPABASE_URL?: string };
}

let remoteJwks: JWTVerifyGetKey | undefined;
function defaultJwks(supabaseUrl: string | undefined): JWTVerifyGetKey {
  if (!remoteJwks) {
    if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    remoteJwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`), {
      cacheMaxAge: 60 * 60 * 1000,
    });
  }
  return remoteJwks;
}

/**
 * Verifies the portal session for an API request. Mirrors the portal's own
 * `lib/auth/jwt.ts` (JWKS, issuer, audience `authenticated`, exp) and adds the
 * `approved` claim requirement. The mock bypass never applies in production.
 */
export async function verifySession(cookieHeader: string | null, opts: SessionOptions = {}): Promise<SessionResult> {
  const env = opts.env ?? process.env;
  if (env.NEXT_PUBLIC_TS_KIT === "mock" && env.NODE_ENV !== "production") {
    return { ok: true, sub: "mock-user", approved: true, displayName: "Dev Learner" };
  }
  const token = extractAccessToken(cookieHeader);
  if (!token) return { ok: false, reason: "missing" };
  try {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const { payload } = await jwtVerify(token, opts.jwks ?? defaultJwks(supabaseUrl), {
      issuer: opts.issuer ?? `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
    });
    if (typeof payload.sub !== "string" || !payload.sub) return { ok: false, reason: "invalid" };
    if (payload.approved !== true) return { ok: false, reason: "pending" };
    const displayName =
      typeof payload.display_name === "string" && payload.display_name ? payload.display_name : "Student";
    return { ok: true, sub: payload.sub, approved: true, displayName };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
