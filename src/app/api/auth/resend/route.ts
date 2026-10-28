import { OAUTH_COOKIE, parseChallengeCookie, readCookie } from "@/server/auth/cookies";
import { AUTH_RESEND_LIMIT } from "@/server/auth/limits";
import { requireAuthConfig } from "@/server/auth/config";
import { resendCode } from "@/server/auth/login";
import { createMailer } from "@/server/auth/mail";
import { publicApi } from "@/server/http";
import { callerIp } from "@/server/rate-limit";
import { getDatabase } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Sends a fresh code for the challenge already in progress.
 *
 * The cooldown and the total-sends cap live in the database row, not in this handler:
 * a restart between two requests must not reset somebody's resend budget.
 */
export function POST(request: Request) {
  return publicApi(
    request,
    async () => {
      const challenge = parseChallengeCookie(readCookie(request.headers.get("cookie"), OAUTH_COOKIE));
      // Nothing to resume: answer the same way as a successful send so an attacker
      // cannot use this endpoint to learn whether a challenge exists.
      if (!challenge) return { ok: true };
      const config = requireAuthConfig();
      await resendCode(await getDatabase(), { challengeId: challenge.id, ip: callerIp(request.headers), mailer: createMailer(config) });
      return { ok: true };
    },
    AUTH_RESEND_LIMIT,
  );
}
