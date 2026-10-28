import { NextResponse, type NextRequest } from "next/server";
import { accessMode, requestAccessError } from "./server/access";
import { readCookie, SESSION_COOKIE } from "./server/auth/cookies";

/**
 * The network boundary in front of the app.
 *
 * Three jobs, in this order:
 *
 *  1. transport admission — the loopback guard locally, Host/Origin/https hosted.
 *  2. a *cheap* gate: does the request carry a session cookie at all?
 *  3. no-store on everything, so a shared browser cannot serve a cached page to the
 *     next person who walks up to it.
 *
 * Step 2 is deliberately not a verification. Proxy runs per request on a path that
 * should stay free of database work, and a revoked session must be refused by
 * `resolveActor` — which it is, on the next hop. The cookie check here exists so the
 * common case (a browser with no cookie, a crawler, a scanner) never reaches a handler
 * at all, and so a person sees a login page instead of a JSON 401.
 */
const HEALTH_PATH = "/api/health";
const PUBLIC_PAGES = new Set(["/login", "/login/code"]);
const PUBLIC_APIS = new Set(["/api/auth/google/start", "/api/auth/google/callback", "/api/auth/verify-code", "/api/auth/resend", "/api/auth/logout"]);

const noStore = (response: NextResponse): NextResponse => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Liveness probes cannot authenticate. This path reveals only that the process is up.
  if (pathname === HEALTH_PATH) return NextResponse.next();

  const error = requestAccessError(request.headers, request.method);
  if (error) {
    const code = accessMode() === "local" ? "local_only" : "access_denied";
    return NextResponse.json({ error: { code, message: error } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (accessMode() === "local") return noStore(NextResponse.next());
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_APIS.has(pathname)) return noStore(NextResponse.next());

  if (readCookie(request.headers.get("cookie"), SESSION_COOKIE)) return noStore(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "unauthorized", message: "You are not signed in." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const target = request.nextUrl.clone();
  const wanted = `${pathname}${request.nextUrl.search}`;
  target.pathname = "/login";
  target.search = wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`;
  return noStore(NextResponse.redirect(target));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
