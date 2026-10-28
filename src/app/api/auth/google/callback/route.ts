import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { clearCookie, OAUTH_COOKIE, parseChallengeCookie, readCookie } from "@/server/auth/cookies";
import { AUTH_CALLBACK_LIMIT } from "@/server/auth/limits";
import { completeCallback } from "@/server/auth/login";
import { publicApi } from "@/server/http";
import { callerIp } from "@/server/rate-limit";
import { getDatabase } from "@/server/runtime";
import { AppError } from "@/server/service";

export const dynamic = "force-dynamic";

const sameValue = (left: string, right: string): boolean => {
  // Compared through a digest so the comparison is over fixed-length input. The values
  // are already unguessable; this is about not leaking length or prefix through timing.
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return a.length === b.length && a.equals(b);
};

/**
 * Google has returned.
 *
 * Two independent checks before the code is exchanged: the browser must present the
 * challenge cookie, and the `state` Google echoed must match the state in that cookie.
 * The database then checks the state against its stored digest on a third axis, so a
 * stolen challenge id alone is not enough.
 *
 * Failures redirect back to `/login` with a code rather than rendering JSON: this URL
 * is reached by a browser navigation, so a human has to be able to read the outcome.
 */
export function GET(request: Request) {
  return publicApi(
    request,
    async () => {
      const url = new URL(request.url);
      const cookie = parseChallengeCookie(readCookie(request.headers.get("cookie"), OAUTH_COOKIE));
      const back = (reason: string) => {
        const response = NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin), 303);
        response.headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
        return response;
      };

      if (!cookie) return back("expired");
      if (url.searchParams.get("error")) return back("denied");

      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (!state || !code) return back("expired");
      if (!sameValue(state, cookie.state)) return back("expired");

      try {
        await completeCallback(await getDatabase(), {
          challengeId: cookie.id,
          state,
          code,
          ip: callerIp(request.headers),
        });
      } catch (error) {
        // A browser landed here, so a JSON error body would be a dead end. The code is
        // carried back as a query value and rendered as a sentence on /login.
        const reason = error instanceof AppError ? error.code : "error";
        return back(reason);
      }

      // The cookie stays: the same challenge now carries the emailed code's attempt
      // budget, and `/api/auth/verify-code` needs it. It expires with the challenge.
      return NextResponse.redirect(new URL("/login/code", url.origin), 303);
    },
    AUTH_CALLBACK_LIMIT,
  );
}
