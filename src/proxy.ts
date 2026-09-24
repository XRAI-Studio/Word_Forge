/**
 * Page-level login gate (class standard, rule 2.1–2.2). Every page request must carry a
 * valid, approved portal session; otherwise the learner is sent to the portal, which
 * refreshes or signs them in and bounces them back to `next`. The kit still does its own
 * client-side check afterwards; this gate keeps the page itself behind the login.
 *
 * Runs on pages only (see `config.matcher`), never on static assets.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySession, type SessionResult } from "@/lib/session";

export const PORTAL = "https://class.travelschooling.com";

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

export interface ProxyEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_TS_KIT?: string;
}

export interface ProxyDeps {
  env?: ProxyEnv;
  verify?: (cookieHeader: string | null, env: ProxyEnv) => Promise<SessionResult>;
}

export function createProxy(deps: ProxyDeps = {}) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const env: ProxyEnv = deps.env ?? process.env;
    const verify = deps.verify ?? ((cookie: string | null, e: ProxyEnv) => verifySession(cookie, { env: e }));

    // Development on localhost runs the mock kit; the portal cookie cannot exist there.
    // Same condition as `shouldUseMockKit()` in src/lib/kit.ts.
    if (env.NODE_ENV !== "production" && DEV_HOSTS.has(request.nextUrl.hostname)) {
      return NextResponse.next();
    }
    // A misconfigured deployment must fail visibly, never redirect: a redirect here would
    // loop between the portal (which sees a valid session) and this gate.
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      return new NextResponse("NEXT_PUBLIC_SUPABASE_URL is not set", { status: 500 });
    }

    const result = await verify(request.headers.get("cookie"), env);
    if (result.ok) return NextResponse.next();
    if (result.reason === "pending") return NextResponse.redirect(`${PORTAL}/waiting`);
    return NextResponse.redirect(`${PORTAL}/login?next=${encodeURIComponent(request.nextUrl.href)}`);
  };
}

export const proxy = createProxy();

/** The inner pattern of the matcher, exported so tests can compile it. */
export const PAGE_MATCH = "^/(?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|json|glb)$).*$";

export const config = {
  // Pages only: mirrors the portal's own matcher, so no JWKS verification runs per asset.
  // `api/` is excluded because API routes verify the session themselves (rule 2.3) and
  // must answer JSON 401/403, never a cross-origin redirect (Word Power review WP-P2-001).
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|json|glb)$).*)"],
};
