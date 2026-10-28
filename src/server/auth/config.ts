import { AppError } from "../service";
import { normalizeEmail } from "./tokens";

/**
 * Hosted authentication configuration.
 *
 * Everything is read from the environment at call time rather than at import time,
 * so tests can vary it and a misconfigured deployment fails on the request that
 * needs the value rather than at module load.
 *
 * The allowlist is **mandatory**. An empty allowlist is not "everyone": it is
 * "not configured", and the deployment refuses to authenticate anyone. That is the
 * only reading of an absent value that cannot accidentally become an open door.
 */
export type MailBackend = "console" | "http";

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  publicOrigin: string;
  redirectUri: string;
  allowedEmails: readonly string[];
  mailBackend: MailBackend;
  mailFrom: string;
  mailUrl: string;
  mailToken: string;
};

export type Configured<Value> = { ok: true; value: Value } | { ok: false; missing: string[] };

const text = (name: string): string => (process.env[name] ?? "").trim();

/** Comma or whitespace separated, lowercased, de-duplicated, empties dropped. */
export function parseEmailList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(normalizeEmail).filter((entry) => entry.includes("@")))];
}

export function readAuthConfig(): Configured<AuthConfig> {
  const missing: string[] = [];
  const clientId = text("GOOGLE_CLIENT_ID");
  const clientSecret = text("GOOGLE_CLIENT_SECRET");
  const publicOrigin = text("RASPBERRY_PUBLIC_ORIGIN").replace(/\/+$/, "");
  const allowedEmails = parseEmailList(text("RASPBERRY_ALLOWED_EMAILS"));
  const mailBackend = (text("RASPBERRY_MAIL_BACKEND") || "console") as MailBackend;
  const mailFrom = text("RASPBERRY_MAIL_FROM");
  const mailUrl = text("RASPBERRY_MAIL_URL");
  const mailToken = text("RASPBERRY_MAIL_TOKEN");

  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!publicOrigin) missing.push("RASPBERRY_PUBLIC_ORIGIN");
  if (allowedEmails.length === 0) missing.push("RASPBERRY_ALLOWED_EMAILS");
  if (mailBackend !== "console" && mailBackend !== "http") missing.push("RASPBERRY_MAIL_BACKEND (must be console or http)");
  if (!mailFrom) missing.push("RASPBERRY_MAIL_FROM");
  if (mailBackend === "http" && !mailUrl) missing.push("RASPBERRY_MAIL_URL");

  if (missing.length) return { ok: false, missing };
  // A plaintext origin would issue a Secure-less cookie and send the OAuth code over
  // http. Refused rather than warned about: this is the one setting where a typo is
  // indistinguishable from an attack.
  if (!publicOrigin.startsWith("https://")) return { ok: false, missing: ["RASPBERRY_PUBLIC_ORIGIN (must start with https://)"] };

  return {
    ok: true,
    value: { clientId, clientSecret, publicOrigin, redirectUri: `${publicOrigin}/api/auth/google/callback`, allowedEmails, mailBackend, mailFrom, mailUrl, mailToken },
  };
}

/** Throws a 503 the API layer already knows how to render. Never logs the values. */
export function requireAuthConfig(): AuthConfig {
  const read = readAuthConfig();
  if (!read.ok) throw new AppError(503, "auth_not_configured", `Sign-in is not configured on this server. Missing: ${read.missing.join(", ")}.`);
  return read.value;
}

export function authConfigured(): boolean {
  return readAuthConfig().ok;
}

/** Constant-time-ish allowlist check. The list is small, so a scan is fine. */
export function isAllowedEmail(email: string, allowed: readonly string[]): boolean {
  const candidate = normalizeEmail(email);
  if (!candidate) return false;
  return allowed.some((entry) => entry === candidate);
}
