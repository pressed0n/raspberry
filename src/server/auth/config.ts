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
 *
 * Sign-in is an emailed six-digit code, and a code is only sent to an address that is
 * both allowlisted *and* already has an account. The allowlist alone is not enough to
 * create one: it is a static string in a deployment's environment, and a typo there
 * should not silently provision a workspace.
 *
 * Google is **optional**. It is a second factor this deployment may layer on top of
 * the code, and it is left out of the required set deliberately: an installation that
 * has no Google client still has to be able to sign its two people in, and requiring a
 * client id it never uses is how a working deployment reads as misconfigured.
 */
export type MailBackend = "console" | "http" | "smtp";

export type AuthConfig = {
  publicOrigin: string;
  allowedEmails: readonly string[];
  /** True only when both halves of a Google client are present. */
  hasGoogle: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  mailBackend: MailBackend;
  mailFrom: string;
  mailUrl: string;
  mailToken: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
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
  const smtpHost = text("RASPBERRY_SMTP_HOST");
  const smtpPort = Number(text("RASPBERRY_SMTP_PORT") || "587");
  const smtpUser = text("RASPBERRY_SMTP_USER");
  const smtpPass = text("RASPBERRY_SMTP_PASS");

  if (!publicOrigin) missing.push("RASPBERRY_PUBLIC_ORIGIN");
  if (allowedEmails.length === 0) missing.push("RASPBERRY_ALLOWED_EMAILS");
  if (mailBackend !== "console" && mailBackend !== "http" && mailBackend !== "smtp") missing.push("RASPBERRY_MAIL_BACKEND (must be console, http or smtp)");
  if (!mailFrom) missing.push("RASPBERRY_MAIL_FROM");
  if (mailBackend === "http" && !mailUrl) missing.push("RASPBERRY_MAIL_URL");
  /* SMTP needs all four. A half-configured server is not "maybe it works": nodemailer will
     happily try to authenticate with an empty password and the operator gets a login
     failure instead of a configuration one. */
  if (mailBackend === "smtp") {
    if (!smtpHost) missing.push("RASPBERRY_SMTP_HOST");
    if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) missing.push("RASPBERRY_SMTP_PORT (must be a port number)");
    if (!smtpUser) missing.push("RASPBERRY_SMTP_USER");
    if (!smtpPass) missing.push("RASPBERRY_SMTP_PASS");
  }
  /* `console` prints the code to the service log. That is a convenience on one machine
     and an account takeover on a host whose logs somebody else can read, so in
     production it counts as *not configured* rather than as a working sender. Catching
     it here means the deployment says so on `/api/health` instead of failing after the
     person has typed their address and waited for an email that was never going out. */
  if (mailBackend === "console" && process.env.NODE_ENV === "production" && process.env.RASPBERRY_MAIL_ALLOW_CONSOLE !== "1") {
    missing.push("RASPBERRY_MAIL_BACKEND (a real sender: http or smtp)");
  }
  // Half a Google client is not a working second factor, and quietly falling back to
  // "no Google" would hide the typo behind a sign-in that still works.
  if (Boolean(clientId) !== Boolean(clientSecret)) missing.push(clientId ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID");

  if (missing.length) return { ok: false, missing };
  // A plaintext origin would issue a Secure-less cookie and send the OAuth code over
  // http. Refused rather than warned about: this is the one setting where a typo is
  // indistinguishable from an attack.
  if (!publicOrigin.startsWith("https://")) return { ok: false, missing: ["RASPBERRY_PUBLIC_ORIGIN (must start with https://)"] };

  return {
    ok: true,
    value: {
      publicOrigin,
      allowedEmails,
      hasGoogle: Boolean(clientId && clientSecret),
      clientId,
      clientSecret,
      redirectUri: `${publicOrigin}/api/auth/google/callback`,
      mailBackend,
      mailFrom,
      mailUrl,
      mailToken,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
    },
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
