import { describe, expect, it, beforeAll } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { extractAccessToken, verifySession } from "@/lib/session";
import { sessionUserId } from "@/lib/session-cookie";

const ISSUER = "https://example.supabase.co/auth/v1";
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: JWTVerifyGetKey;

async function token(overrides: Record<string, unknown> = {}, opts: { aud?: string; exp?: string; sub?: string | null } = {}) {
  const jwt = new SignJWT({ approved: true, role_name: "student", display_name: "Ada", ...overrides })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "user-1");
  return jwt.sign(privateKey);
}

function cookie(accessToken: string) {
  return "sb-abc-auth-token=" + encodeURIComponent(JSON.stringify({ access_token: accessToken, token_type: "bearer" }));
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "ES256", use: "sig" }] });
});

describe("extractAccessToken", () => {
  it("reads a plain url-encoded JSON cookie", () => {
    expect(extractAccessToken(cookie("T1"))).toBe("T1");
  });
  it("joins numbered chunks in order and strips the base64- prefix", () => {
    const payload = Buffer.from(JSON.stringify({ access_token: "T2" })).toString("base64url");
    const b64 = "base64-" + payload;
    const cut = Math.floor(b64.length / 2);
    const header = `other=1; sb-abc-auth-token.1=${b64.slice(cut)}; sb-abc-auth-token.0=${b64.slice(0, cut)}`;
    expect(extractAccessToken(header)).toBe("T2");
  });
  it("returns null when there is no session cookie or it is malformed", () => {
    expect(extractAccessToken(null)).toBeNull();
    expect(extractAccessToken("foo=bar")).toBeNull();
    expect(extractAccessToken("sb-abc-auth-token=not-json")).toBeNull();
  });
});

describe("sessionUserId (client-side identity check, no verification)", () => {
  it("reads the subject out of the cookie's access token", async () => {
    expect(sessionUserId(cookie(await token({}, { sub: "user-42" })))).toBe("user-42");
  });
  it("is null without a usable cookie or token", async () => {
    expect(sessionUserId("")).toBeNull();
    expect(sessionUserId("sb-abc-auth-token=" + encodeURIComponent(JSON.stringify({ access_token: "not.a.jwt" })))).toBeNull();
    expect(sessionUserId(cookie(await token({}, { sub: null })))).toBeNull();
  });
});

describe("verifySession", () => {
  it("accepts a valid approved token", async () => {
    const result = await verifySession(cookie(await token()), { jwks, issuer: ISSUER });
    expect(result).toEqual({ ok: true, sub: "user-1", approved: true, displayName: "Ada" });
  });
  it("reports a pending account when approved is false", async () => {
    const result = await verifySession(cookie(await token({ approved: false })), { jwks, issuer: ISSUER });
    expect(result).toEqual({ ok: false, reason: "pending" });
  });
  it("rejects an expired token", async () => {
    const result = await verifySession(cookie(await token({}, { exp: "-1h" })), { jwks, issuer: ISSUER });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects the wrong audience", async () => {
    const result = await verifySession(cookie(await token({}, { aud: "anon" })), { jwks, issuer: ISSUER });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects a token without a subject", async () => {
    const result = await verifySession(cookie(await token({}, { sub: null })), { jwks, issuer: ISSUER });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
  it("reports a missing cookie", async () => {
    expect(await verifySession(null, { jwks, issuer: ISSUER })).toEqual({ ok: false, reason: "missing" });
  });
  it("allows the mock bypass only outside production", async () => {
    expect(await verifySession(null, { env: { NEXT_PUBLIC_TS_KIT: "mock", NODE_ENV: "development" } })).toEqual({
      ok: true,
      sub: "mock-user",
      approved: true,
      displayName: "Dev Learner",
    });
    expect(await verifySession(null, { env: { NEXT_PUBLIC_TS_KIT: "mock", NODE_ENV: "production" }, jwks, issuer: ISSUER })).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
