import { NextResponse } from "next/server";
import { z } from "zod";
import { clearCookie, OAUTH_COOKIE, parseChallengeCookie, readCookie, serializeCookie, SESSION_COOKIE } from "@/server/auth/cookies";
import { AUTH_CODE_LIMIT } from "@/server/auth/limits";
import { completeLogin } from "@/server/auth/login";
import { SESSION_ABSOLUTE_MS } from "@/server/auth/session-store";
import { AppError } from "@/server/service";
import { publicApi, readBody } from "@/server/http";
import { callerIp } from "@/server/rate-limit";
import { getDatabase } from "@/server/runtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email.") }).strict();

/**
 * The second factor.
 *
 * On success the session cookie is set and the challenge cookie is cleared in the same
 * response, so a browser cannot hold two halves of two different logins at once.
 */
export async function POST(request: Request) {
  return publicApi(
    request,
    async () => {
      const challenge = parseChallengeCookie(readCookie(request.headers.get("cookie"), OAUTH_COOKIE));
      if (!challenge) throw new AppError(400, "login_expired", "That sign-in attempt expired. Start again.");

      const parsed = bodySchema.safeParse(await readBody(request));
      if (!parsed.success) throw new AppError(400, "invalid_code", parsed.error.issues[0]?.message ?? "Enter the 6-digit code.");

      const login = await completeLogin(await getDatabase(), {
        challengeId: challenge.id,
        code: parsed.data.code,
        ip: callerIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });

      const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      response.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, login.token, { maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 }));
      response.headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
      return response;
    },
    AUTH_CODE_LIMIT,
  );
}
