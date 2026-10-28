import { randomUUID } from "node:crypto";
import type { Sql } from "../database";
import { sha256 } from "./tokens";

/**
 * Authentication audit trail.
 *
 * Email addresses and IPs are stored as SHA-256 digests. A login log that keeps raw
 * addresses is a second copy of the user list — precisely what someone who has
 * already got into the database would like to find. Digests still let you answer
 * "was this the same address that succeeded ten minutes ago".
 *
 * Codes and tokens are never recorded, at any level of detail.
 */
export type AuthEventKind =
  | "login_started"
  | "login_state_rejected"
  | "login_not_allowlisted"
  | "login_email_unverified"
  | "login_code_sent"
  | "login_code_failed"
  | "login_code_expired"
  | "login_code_wrong"
  | "login_code_exhausted"
  | "login_code_reused"
  | "login_succeeded"
  | "session_rejected"
  | "logout"
  | "mail_failed";

export type AuthEvent = { kind: AuthEventKind; email?: string | null; ip?: string | null; detail?: string | null };

export const digest = (value: string | null | undefined): string | null => (value ? sha256(value.trim().toLowerCase()) : null);

export async function recordEvent(sql: Sql, event: AuthEvent, now = new Date()): Promise<void> {
  // Audit writing must never be able to fail a login: a full disk should not lock the
  // owner out of their own notes.
  try {
    await sql.query("INSERT INTO auth_events(id,at,kind,email_hash,ip_hash,detail) VALUES($1,$2,$3,$4,$5,$6)", [
      randomUUID(),
      now.toISOString(),
      event.kind,
      digest(event.email),
      digest(event.ip),
      event.detail ?? null,
    ]);
  } catch {
    // Intentionally swallowed; see above.
  }
}
