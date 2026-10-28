import { HOSTED_AUTH_PENDING, accessMode } from "./access";
import { AppError, localActor, type Actor } from "./service";

/**
 * Resolves the caller of a request exactly once, at the edge of the API.
 *
 * Today there is one honest answer: the local development actor. When sessions
 * land, this function is the only place that changes — read the session cookie,
 * verify it against `sessions`, load the membership role, and return an Actor
 * whose `clientId` is the session id rather than the shared "browser" string.
 * Everything downstream already receives an Actor instead of importing a
 * module-level constant, so no route or MCP tool needs to be touched again.
 *
 * The signature is async on purpose so that adding a database lookup later does
 * not ripple into every call site.
 */
export async function resolveActor(request: Request): Promise<Actor> {
  if (accessMode() === "local") return localActor("browser");
  // Fail closed. No session store exists yet, so hosted mode is unreachable by
  // construction rather than merely unimplemented.
  void request;
  throw new AppError(503, "auth_not_configured", HOSTED_AUTH_PENDING);
}
