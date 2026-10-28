import { NextResponse } from "next/server";
import { CHALLENGE_TTL_MS } from "@/server/auth/challenges";
import { OAUTH_COOKIE, serializeCookie } from "@/server/auth/cookies";
import { AUTH_START_LIMIT } from "@/server/auth/limits";
import { beginLogin } from "@/server/auth/login";
import { publicApi } from "@/server/http";
import { getDatabase } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Begins sign-in: mint a challenge, send the browser to Google.
 *
 * The challenge id and its state travel together in one `__Host-` cookie. The state is
 * also sent to Google, which returns it, so the callback can prove that the browser
 * finishing the flow is the browser that started it.
 */
export function GET(request: Request) {
  return publicApi(
    request,
    async () => {
      const begun = await beginLogin(await getDatabase());
      const response = NextResponse.redirect(begun.url, 303);
      response.headers.append("Set-Cookie", serializeCookie(OAUTH_COOKIE, `${begun.challengeId}.${begun.state}`, { maxAgeSeconds: CHALLENGE_TTL_MS / 1000 }));
      return response;
    },
    AUTH_START_LIMIT,
  );
}
