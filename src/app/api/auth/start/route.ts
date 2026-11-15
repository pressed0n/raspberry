import { NextResponse } from "next/server";
import { z } from "zod";
import { CODE_TTL_MS } from "@/server/auth/challenges";
import { OAUTH_COOKIE, serializeCookie } from "@/server/auth/cookies";
import { AUTH_START_LIMIT } from "@/server/auth/limits";
import { startEmailLogin } from "@/server/auth/login";
import { AppError } from "@/server/service";
import { publicApi, readBody } from "@/server/http";
import { callerIp } from "@/server/rate-limit";
import { getDatabase } from "@/server/runtime";

export const dynamic = "force-dynamic";

/* No `.email()` here on purpose. Zod's validator rejects some addresses a mail server
   would happily deliver to, and its message says "invalid email" to someone whose
   address is perfectly valid but unusual. The shape that actually matters — one address,
   no header injection — is enforced by `assertAddress` at the point the message is
   built, and the allowlist is the real door. This only keeps obvious junk off the wire. */
const bodySchema = z.object({ email: z.string().trim().min(3).max(254) }).strict();

/**
 * Step one: an address goes in, a six-digit code comes out of the mail server.
 *
 * The challenge id and its state travel in one `__Host-` cookie, exactly as the Google
 * flow does, so `/api/auth/verify-code` cannot be driven by an id alone. Nothing about
 * the address is put in the cookie: it is written into the challenge row, server-side,
 * where the browser cannot choose which mailbox a code was for.
 *
 * The response deliberately says which of the two refusals happened — not on the list, or
 * on the list with no account yet. Both are 403s and neither is a secret worth more than
 * the operator's ability to tell them apart.
 */
export function POST(request: Request) {
  return publicApi(
    request,
    async () => {
      const parsed = bodySchema.safeParse(await readBody(request));
      if (!parsed.success) throw new AppError(400, "invalid_email", "Enter the email address you sign in with.");

      const started = await startEmailLogin(await getDatabase(), { email: parsed.data.email, ip: callerIp(request.headers) });

      const response = NextResponse.json(
        { ok: true, email: started.email, expiresAt: started.expiresAt },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.headers.append("Set-Cookie", serializeCookie(OAUTH_COOKIE, `${started.challengeId}.${started.state}`, { maxAgeSeconds: CODE_TTL_MS / 1000 }));
      return response;
    },
    AUTH_START_LIMIT,
  );
}
