import { NextResponse } from "next/server";
import { clearCookie, readCookie, SESSION_COOKIE } from "@/server/auth/cookies";
import { revokeSession, verifySession } from "@/server/auth/session-store";
import { recordEvent } from "@/server/auth/events";
import { AUTH_LOGOUT_LIMIT } from "@/server/auth/limits";
import { accessMode } from "@/server/access";
import { publicApi } from "@/server/http";
import { callerIp } from "@/server/rate-limit";
import { getDatabase } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Signs out.
 *
 * POST only, because a GET sign-out is a link somebody else can embed. The transport
 * guard already refuses a cross-origin mutation, so this cannot be triggered by a page
 * the user is merely visiting.
 *
 * The session row is revoked, not merely forgotten: a copied cookie has to stop working
 * too, which clearing the browser's copy would not achieve.
 */
export function POST(request: Request) {
  return publicApi(
    request,
    async () => {
      const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
      const database = await getDatabase();
      if (token) {
        const verified = await verifySession(database, token, { touch: false });
        if (verified.ok) {
          await revokeSession(database, verified.session.sessionId, "logout");
          await database.transaction((sql) => recordEvent(sql, { kind: "logout", ip: callerIp(request.headers) }));
        }
      }
      // Always the same answer: whether a session existed is not information this
      // endpoint gives away, and a stale cookie still needs clearing.
      const response = NextResponse.json({ ok: true, mode: accessMode() }, { headers: { "Cache-Control": "no-store" } });
      response.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
      return response;
    },
    AUTH_LOGOUT_LIMIT,
  );
}
