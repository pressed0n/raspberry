import { NextResponse, type NextRequest } from "next/server";
import { accessMode, requestAccessError } from "./server/access";

// Liveness probes cannot authenticate, so this path is exempt from the access
// guard. It reveals nothing beyond "the process is up" (see api/health/route.ts).
const HEALTH_PATH = "/api/health";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === HEALTH_PATH) return NextResponse.next();
  const error = requestAccessError(request.headers, request.method);
  if (error) {
    const code = accessMode() === "local" ? "local_only" : "access_denied";
    return NextResponse.json({ error: { code, message: error } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
