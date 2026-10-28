import { createHash } from "node:crypto";
import { AppError } from "../service";
import type { AuthConfig } from "./config";

/**
 * Google sign-in, without an OAuth library.
 *
 * The token exchange and the userinfo call both happen server-to-server over TLS,
 * and identity is read from Google's userinfo endpoint using the access token that
 * exchange just produced. That deliberately avoids verifying an `id_token` JWT by
 * hand: signature checking against a rotating JWKS, `alg` confusion, `aud`/`azp`/`nonce`
 * matching and clock skew are collectively the easiest place to get authentication
 * catastrophically wrong, and there is no version of that code that is short enough
 * to review comfortably.
 */
const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** S256 challenge for a PKCE verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizationUrl(config: AuthConfig, input: { state: string; verifier: string }): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", pkceChallenge(input.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // `prompt=select_account` matters on a shared machine: it stops a second person
  // from being silently signed in as whoever used the browser last.
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  return url.toString();
}

export type GoogleIdentity = { subject: string; email: string; emailVerified: boolean; name: string | null };

const failure = (code: string, message: string) => new AppError(502, code, message);

export async function exchangeCode(
  config: AuthConfig,
  input: { code: string; verifier: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<GoogleIdentity> {
  const tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code_verifier: input.verifier,
    }).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!tokenResponse.ok) throw failure("google_exchange_failed", "Google sign-in did not complete. Try again.");

  const token = (await tokenResponse.json().catch(() => null)) as { access_token?: unknown; token_type?: unknown } | null;
  const accessToken = typeof token?.access_token === "string" ? token.access_token : "";
  if (!accessToken) throw failure("google_exchange_failed", "Google sign-in did not complete. Try again.");

  const userResponse = await fetchImpl(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!userResponse.ok) throw failure("google_userinfo_failed", "Google did not confirm that account. Try again.");

  const info = (await userResponse.json().catch(() => null)) as Record<string, unknown> | null;
  const subject = typeof info?.sub === "string" ? info.sub : "";
  const email = typeof info?.email === "string" ? info.email.trim().toLowerCase() : "";
  // Only a literal `true` counts. Google sends a boolean, but a string "false" or a
  // missing field must not be read as verified.
  const emailVerified = info?.email_verified === true;
  if (!subject || !email) throw failure("google_userinfo_failed", "Google did not return an account identity. Try again.");

  return { subject, email, emailVerified, name: typeof info?.name === "string" ? info.name : null };
}
