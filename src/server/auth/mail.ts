import { AppError } from "../service";
import type { AuthConfig } from "./config";

/**
 * Sending a login code.
 *
 * Two backends, no dependencies. `http` POSTs to a relay you point at whatever
 * provider you use; `console` prints to stderr and exists only so the flow can be
 * exercised on one machine.
 *
 * There is deliberately no hand-written SMTP client. STARTTLS negotiation, AUTH
 * exchange and dot-stuffing are exactly the kind of protocol work where a subtle
 * mistake turns into a downgrade or header injection, and that is the wrong place
 * to be clever. If you need SMTP, add nodemailer as a pinned dependency rather
 * than this file growing a parser.
 */
export type MailMessage = { to: string; subject: string; text: string };
export type Mailer = (message: MailMessage) => Promise<void>;

const addressShape = /^[^\s@,;:<>]+@[^\s@,;:<>]+\.[^\s@,;:<>]+$/;

export function assertAddress(address: string): string {
  // A newline in a header value is header injection; a comma or semicolon is a second
  // recipient. Both are refused before the address touches the transport.
  if (!addressShape.test(address)) throw new AppError(400, "invalid_email", "That email address cannot receive a login code.");
  return address;
}

export function createMailer(config: AuthConfig, fetchImpl: typeof fetch = fetch): Mailer {
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
      throw new AppError(503, "mail_not_configured", "Email delivery is not configured. Set RASPBERRY_MAIL_BACKEND=http and RASPBERRY_MAIL_URL.");
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
