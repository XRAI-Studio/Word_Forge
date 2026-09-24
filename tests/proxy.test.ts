import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { PAGE_MATCH, PORTAL, config, createProxy } from "../src/proxy";
import type { SessionResult } from "../src/lib/session";

const PROD = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" };
const GAME = "https://factors.travelschooling.com/";

const ok: SessionResult = { ok: true, sub: "user-1", approved: true, displayName: "Ada" };
const missing: SessionResult = { ok: false, reason: "missing" };
const invalid: SessionResult = { ok: false, reason: "invalid" };
const pending: SessionResult = { ok: false, reason: "pending" };

function request(url = GAME, cookie?: string) {
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

describe("proxy (page login gate)", () => {
  it("redirects to the portal login with next= when there is no session", async () => {
    const res = await createProxy({ env: PROD, verify: async () => missing })(request());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${PORTAL}/login?next=${encodeURIComponent(GAME)}`);
  });

  it("carries the full request URL (path and query) in next=", async () => {
    const res = await createProxy({ env: PROD, verify: async () => missing })(request(`${GAME}?tier=off`));
    expect(res.headers.get("location")).toBe(`${PORTAL}/login?next=${encodeURIComponent(`${GAME}?tier=off`)}`);
  });

  it("treats an invalid token like a missing one", async () => {
    const res = await createProxy({ env: PROD, verify: async () => invalid })(request(GAME, "sb-x-auth-token=bad"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(new RegExp(`^${PORTAL}/login\\?next=`));
  });

  it("sends an unapproved learner to the portal waiting page", async () => {
    const res = await createProxy({ env: PROD, verify: async () => pending })(request());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${PORTAL}/waiting`);
  });

  it("passes a valid approved session through and hands the verifier the cookie", async () => {
    const verify = vi.fn(async () => ok);
    const res = await createProxy({ env: PROD, verify })(request(GAME, "sb-x-auth-token=good"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(verify).toHaveBeenCalledWith("sb-x-auth-token=good", PROD);
  });

  it("answers 500, never a redirect, when the Supabase URL is unset in production", async () => {
    const verify = vi.fn(async () => ok);
    const res = await createProxy({ env: { NODE_ENV: "production" }, verify })(request());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("NEXT_PUBLIC_SUPABASE_URL is not set");
    expect(res.headers.get("location")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("lets localhost through in development without verifying", async () => {
    const verify = vi.fn(async () => missing);
    for (const url of ["http://localhost:3112/", "http://127.0.0.1:3112/?tier=off"]) {
      const res = await createProxy({ env: { NODE_ENV: "development" }, verify })(request(url));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("does not bypass on localhost in production, nor on the real host in development", async () => {
    const res1 = await createProxy({ env: PROD, verify: async () => missing })(request("http://localhost:3000/"));
    expect(res1.status).toBe(307);
    const res2 = await createProxy({ env: { NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://x" }, verify: async () => missing })(request());
    expect(res2.status).toBe(307);
  });
});

describe("proxy matcher", () => {
  it("excludes Next internals and static file extensions, mirroring the portal", () => {
    const m = config.matcher[0];
    for (const part of ["api/", "_next/static", "_next/image", "favicon.ico", "svg", "png", "css", "js", "map", "woff2?", "json", "glb"]) {
      expect(m).toContain(part);
    }
  });

  it("the exported pattern is the matcher's inner regex", () => {
    // config.matcher[0] is `/(` + inner + `)`; PAGE_MATCH anchors the same inner regex.
    expect(config.matcher[0]).toBe(`/(${PAGE_MATCH.slice(2, -1)})`);
  });

  it("matches pages and nothing else", () => {
    const re = new RegExp(PAGE_MATCH);
    for (const path of ["/", "/reference", "/quiz/round-2"]) expect(re.test(path), path).toBe(true);
    for (const path of ["/api/analyze", "/api/coach", "/api/anything/deep", "/_next/static/chunks/x.js", "/_next/image?url=x", "/favicon.ico", "/model.glb", "/data/12.json", "/fonts/a.woff2"]) {
      expect(re.test(path), path).toBe(false);
    }
  });
});
