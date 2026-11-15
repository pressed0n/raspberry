import nodemailer from "nodemailer";
import { AppError } from "../service";
import type { AuthConfig } from "./config";

/**
 * Sending a login code.
 *
 * Three backends. `http` POSTs to a relay you point at whatever provider you use; `smtp`
 * hands the message to nodemailer; `console` prints to stderr and exists only so the flow
 * can be exercised on one machine.
 *
 * There is deliberately no hand-written SMTP client. STARTTLS negotiation, AUTH
 * exchange and dot-stuffing are exactly the kind of protocol work where a subtle
 * mistake turns into a downgrade or header injection, and that is the wrong place to
 * be clever — so nodemailer is a pinned dependency instead. It is the only one added for
 * hosting, and it earns its place: STARTTLS, auth mechanism selection, per-recipient
 * retry and the MIME encoding of a plain-text body are all things this file would
 * otherwise have to get right.
 *
 * Every backend throws the same error for the same reason. A caller cannot tell whether
 * a relay refused, a password expired or a DNS lookup failed, and should not have to:
 * the operator gets the detail in the log, and the person gets "try again in a moment"
 * rather than a message that reads like their fault.
 */
export type MailMessage = { to: string; subject: string; text: string };
export type Mailer = (message: MailMessage) => Promise<void>;

/**
 * What nodemailer is handed, as a value rather than inline.
 *
 * Extracted so the one setting that is easy to get wrong can be asserted in a test:
 * TLS is verified against `smtpHost`, or against `smtpServername` when the relay's
 * certificate is issued for a different name than the one in DNS. Shared hosting does
 * exactly that, and the only alternatives to the override are turning verification off
 * (encrypting the password to an unverified peer) or pointing `smtpHost` at the
 * provider's machine name. See `AuthConfig.smtpServername`.
 */
export function smtpTransportOptions(config: AuthConfig) {
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    // 465 is implicit TLS; 587 starts plaintext and upgrades. Anything else is only
    // sane behind a local relay, which a hosted deployment is not.
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    ...(config.smtpServername ? { tls: { servername: config.smtpServername } } : {}),
  };
}

const addressShape = /^[^\s@,;:<>]+@[^\s@,;:<>]+\.[^\s@,;:<>]+$/;

export function assertAddress(address: string): string {
  // A newline in a header value is header injection; a comma or semicolon is a second
  // recipient. Both are refused before the address touches the transport.
  if (!addressShape.test(address)) throw new AppError(400, "invalid_email", "That email address cannot receive a login code.");
  return address;
}

function deliveryFailed(error: unknown): AppError {
  // The reason goes to the log, never to the caller: an SMTP rejection can quote the
  // recipient, the relay host and sometimes the credential.
  console.error("Raspberry mail failed", error instanceof Error ? error.name : "UnknownError", error instanceof Error ? error.message : String(error));
  return new AppError(502, "mail_failed", "The login code could not be sent. Try again in a moment.");
}

export function createMailer(config: AuthConfig, fetchImpl: typeof fetch = fetch): Mailer {
  if (config.mailBackend === "smtp") {
    /* Built once, lazily. A pool would be a lifetime to manage on a serverless runtime and
       the volume here is two people signing in; one connection per send is the right
       trade at this size. */
    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    return async (message) => {
      assertAddress(message.to);
      transport ??= nodemailer.createTransport(smtpTransportOptions(config));
      try {
        await transport.sendMail({ from: config.mailFrom, to: message.to, subject: message.subject, text: message.text });
      } catch (error) {
        throw deliveryFailed(error);
      }
    };
  }

  if (config.mailBackend === "http") {
    return async (message) => {
      assertAddress(message.to);
      const response = await fetchImpl(config.mailUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(config.mailToken ? { Authorization: `Bearer ${config.mailToken}` } : {}) },
        body: JSON.stringify({ from: config.mailFrom, to: message.to, subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(10_000),
      });
      // The body is not included: a relay error page is not worth risking an echo of
      // the message, and the message contains a live login code.
      if (!response.ok) throw new AppError(502, "mail_failed", "The login code could not be sent. Try again in a moment.");
    };
  }

  return async (message) => {
    assertAddress(message.to);
    if (process.env.NODE_ENV === "production" && process.env.RASPBERRY_MAIL_ALLOW_CONSOLE !== "1") {
      // A service log holding live login codes is an account takeover for anyone with
      // log access. Refused in production unless the operator says so explicitly.
      throw new AppError(503, "mail_not_configured", "Email delivery is not configured. Set RASPBERRY_MAIL_BACKEND=http and RASPBERRY_MAIL_URL, or RASPBERRY_MAIL_BACKEND=smtp.");
    }
    console.error(`[raspberry mail] to=${message.to}\n[raspberry mail] subject=${message.subject}\n${message.text}\n[raspberry mail] --- end ---`);
  };
}

export function loginCodeMessage(code: string, minutes: number): string {
  return [
    `Your Raspberry sign-in code is ${code}.`,
    "",
    `It expires in ${minutes} minutes and can be used once.`,
    "If you did not just try to sign in, someone has your Google password — change it now, and do not enter this code.",
  ].join("\n");
}
