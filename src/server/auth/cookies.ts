/**
 * Cookie names and serialisation.
 *
 * All three cookies use the `__Host-` prefix, which browsers only accept with
 * `Secure`, `Path=/` and no `Domain`. That combination means a subdomain cannot set
 * or overwrite them, which is the difference between "an attacker needs my origin"
 * and "an attacker needs any subdomain of my domain".
 *
 * `SameSite=Lax` rather than `Strict`: the OAuth callback arrives as a top-level
 * cross-site navigation from Google, and a Strict cookie would not be sent with it,
 * breaking the flow it is meant to protect.
 */
export const SESSION_COOKIE = "__Host-raspberry_session";
export const OAUTH_COOKIE = "__Host-raspberry_oauth";

export type CookieOptions = { maxAgeSeconds: number };

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  return [`${name}=${value}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`].join("; ");
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0 });
}

/** Parses one cookie out of a Cookie header without trusting the rest of it. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

/** `<challengeId>.<state>` — both halves are needed to resume a login. */
export function parseChallengeCookie(value: string | null): { id: string; state: string } | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const state = value.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || state.length < 32) return null;
  return { id, state };
}
