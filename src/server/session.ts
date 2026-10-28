import { accessMode } from "./access";
import { readCookie, SESSION_COOKIE } from "./auth/cookies";
import { requireAuthConfig } from "./auth/config";
import { verifySession } from "./auth/session-store";
import { getDatabase } from "./runtime";
import { AppError, localActor, type Actor } from "./service";

/**
 * Resolves the caller of a request exactly once, at the edge of the API.
 *
 * Two modes, and both fail closed:
 *
 * - `local`   : the loopback guard has already run, so the caller is the local user.
 *               Nothing about this path depends on a cookie.
 * - `session` : the cookie is the only thing that admits a request. A missing cookie,
 *               an unknown one, an expired one, or a revoked one all produce the same
 *               401 — the reason only goes to the audit log, never to the caller.
 *
 * `clientId` is the session id, not a shared constant. That matters beyond bookkeeping:
 * idempotency receipts are keyed by it, so two devices saving the same page no longer
 * share a mutation namespace.
 *
 * The signature stays async for the database lookup, which is what every call site was
 * built around even before it existed.
 */
export async function resolveActor(request: Request): Promise<Actor> {
  if (accessMode() === "local") return localActor("browser");

  // A hosted deployment with no configuration cannot authenticate anyone, and this is
  // the error that says so rather than the one that says "wrong password".
  requireAuthConfig();

  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) throw unauthorized("You are not signed in.");

  const database = await getDatabase();
  const result = await verifySession(database, token);
  if (!result.ok) throw unauthorized("Your session has ended. Sign in again.");

  return { userId: result.session.userId, workspaceId: result.session.workspaceId, clientId: result.session.sessionId };
}

/** One shape for every reason a session is not usable. */
export function unauthorized(message = "You are not signed in."): AppError {
  return new AppError(401, "unauthorized", message);
}
