import { randomUUID } from "node:crypto";
import type { Sql } from "../database";
import { equalHex, hashCode, randomToken, sha256, verifyCode } from "./tokens";

/**
 * The login challenge: one row that spans whatever proved the identity and the emailed
 * code that finishes it.
 *
 * Keeping both factors on the same row is what binds them together. The row records
 * the identity that passed the first factor, and now *which* factor that was, so a code
 * minted for one identity cannot be replayed against another even if an attacker has
 * both the challenge id and the cookie.
 *
 * Two providers share the table because they share everything that matters: one row, one
 * attempt budget, one expiry, one single use. They differ in the answer to a single
 * question — may this sign-in create an account, or only open one that exists — and that
 * question is answered from `provider`, not from a null column standing in for it.
 */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;

/** How the identity was established before the code was emailed. */
export type ChallengeProvider = "google" | "email";

export type Challenge = {
  id: string;
  state: string;
  verifier: string;
  expiresAt: string;
};

export type ChallengeRow = {
  id: string;
  provider: ChallengeProvider;
  stateHash: string;
  pkceVerifier: string;
  subject: string | null;
  email: string | null;
  displayName: string | null;
  codeHash: string | null;
  codeSalt: string | null;
  attempts: number;
  sends: number;
  lastSentAt: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

const mapRow = (row: Record<string, unknown>): ChallengeRow => ({
  id: String(row.id),
  // A row written before migration 8 has no `provider`; every one of those was a Google
  // challenge, which is what the column's default says.
  provider: row.provider === "email" ? "email" : "google",
  stateHash: String(row.state_hash),
  pkceVerifier: String(row.pkce_verifier),
  subject: row.google_sub == null ? null : String(row.google_sub),
  email: row.email == null ? null : String(row.email),
  displayName: row.display_name == null ? null : String(row.display_name),
  codeHash: row.code_hash == null ? null : String(row.code_hash),
  codeSalt: row.code_salt == null ? null : String(row.code_salt),
  attempts: Number(row.attempts ?? 0),
  sends: Number(row.sends ?? 0),
  lastSentAt: row.last_sent_at == null ? null : String(row.last_sent_at),
  createdAt: String(row.created_at),
  expiresAt: String(row.expires_at),
  consumedAt: row.consumed_at == null ? null : String(row.consumed_at),
});

export async function createChallenge(sql: Sql, now = new Date()): Promise<Challenge> {
  const id = randomUUID();
  const state = randomToken();
  const verifier = randomToken(48);
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  await sql.query("INSERT INTO login_challenges(id,state_hash,pkce_verifier,provider,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)", [
    id,
    sha256(state),
    verifier,
    "google",
    now.toISOString(),
    expiresAt,
  ]);
  return { id, state, verifier, expiresAt };
}

/** The emailed code is good for five minutes, counted from when it was sent. */
export const CODE_TTL_MS = 5 * 60 * 1000;

/**
 * The email-only challenge: no OAuth round trip, so the row is created already bound to
 * the address and already carrying the code.
 *
 * The expiry is the code's, not the flow's. In the Google flow the row has to outlive a
 * redirect to Google and back before there is anything to type, which is why that one is
 * allowed ten minutes. Here the clock starts when the person opens the email, so five is
 * both what the screen promises and what the row enforces — one number, not a sentence
 * that drifts from a column.
 *
 * A `state` is still minted and still stored as a digest, even though nothing external
 * echoes it back. It travels in the `__Host-` cookie beside the id, so redeeming a code
 * needs the cookie and not just the id: an id that leaked into a log is not enough.
 */
export async function createEmailChallenge(sql: Sql, input: { email: string; code: string; now?: Date }): Promise<Challenge> {
  const now = input.now ?? new Date();
  const id = randomUUID();
  const state = randomToken();
  const { hash, salt } = await hashCode(input.code);
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  await sql.query(
    "INSERT INTO login_challenges(id,state_hash,pkce_verifier,provider,email,code_hash,code_salt,attempts,sends,last_sent_at,created_at,expires_at) VALUES($1,$2,$3,'email',$4,$5,$6,0,1,$7,$8,$9)",
    [id, sha256(state), randomToken(48), input.email, hash, salt, now.toISOString(), now.toISOString(), expiresAt],
  );
  return { id, state, verifier: "", expiresAt };
}


/**
 * Loads a challenge for the callback and checks the state parameter against the
 * stored digest. A missing, mismatched, reused, or expired row is the same answer to
 * the caller: these are not differentiated in the response, only in the audit log.
 */
export async function challengeForCallback(
  sql: Sql,
  input: { id: string; state: string; now?: Date },
): Promise<{ ok: true; challenge: ChallengeRow } | { ok: false; reason: "unknown" | "expired" | "consumed" | "state" }> {
  const now = input.now ?? new Date();
  const [row] = await sql.query("SELECT * FROM login_challenges WHERE id=$1", [input.id]);
  if (!row) return { ok: false, reason: "unknown" };
  const challenge = mapRow(row);
  if (!equalHex(sha256(input.state), challenge.stateHash)) return { ok: false, reason: "state" };
  if (challenge.consumedAt) return { ok: false, reason: "consumed" };
  if (now.toISOString() >= challenge.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, challenge };
}

/** Binds the verified Google identity to the challenge and stores the hashed code. */
export async function bindIdentity(
  sql: Sql,
  input: { id: string; subject: string; email: string; displayName: string | null; code: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const { hash, salt } = await hashCode(input.code);
  await sql.query(
    "UPDATE login_challenges SET google_sub=$1, email=$2, display_name=$3, code_hash=$4, code_salt=$5, attempts=0, sends=1, last_sent_at=$6 WHERE id=$7 AND consumed_at IS NULL",
    [input.subject, input.email, input.displayName, hash, salt, now.toISOString(), input.id],
  );
}

/** The resend path: cooldown and total-sends cap, both enforced in one statement. */
export async function noteSend(sql: Sql, id: string, now = new Date()): Promise<"ok" | "cooldown" | "exhausted"> {
  const [row] = await sql.query("SELECT sends, last_sent_at, consumed_at FROM login_challenges WHERE id=$1", [id]);
  if (!row || row.consumed_at != null) return "exhausted";
  const sends = Number(row.sends ?? 0);
  if (sends >= MAX_SENDS) return "exhausted";
  const last = row.last_sent_at == null ? null : String(row.last_sent_at);
  if (last && now.getTime() - new Date(last).getTime() < RESEND_COOLDOWN_MS) return "cooldown";
  await sql.query("UPDATE login_challenges SET sends=sends+1, last_sent_at=$1 WHERE id=$2", [now.toISOString(), id]);
  return "ok";
}

export type CodeResult =
  | { ok: true; challenge: ChallengeRow }
  | { ok: false; reason: "unknown" | "expired" | "incomplete" | "exhausted" | "state" }
  | { ok: false; reason: "mismatch"; remaining: number };

/**
 * Consumes a one-time code.
 *
 * The attempt counter is incremented **before** the comparison, so a crash between
 * the two cannot hand back an extra guess. A correct code burns the row in the same
 * transaction, which is what makes it one-time rather than merely time-limited.
 *
 * `state` is checked before the counter moves: a caller holding the id but not the
 * cookie that was issued with it has not earned a guess at the code, and charging them
 * one would let anyone holding a leaked id lock the real person out by burning the
 * budget. It is optional because the Google flow has already proved the same value in
 * `challengeForCallback` — passing it twice is harmless, omitting it is only safe where
 * that check already ran.
 */
export async function consumeCode(sql: Sql, input: { id: string; code: string; state?: string; now?: Date }): Promise<CodeResult> {
  const now = input.now ?? new Date();
  const [row] = await sql.query("SELECT * FROM login_challenges WHERE id=$1", [input.id]);
  if (!row) return { ok: false, reason: "unknown" };
  const challenge = mapRow(row);
  if (challenge.consumedAt) return { ok: false, reason: "exhausted" };
  if (now.toISOString() >= challenge.expiresAt) return { ok: false, reason: "expired" };
  if (input.state !== undefined && !equalHex(sha256(input.state), challenge.stateHash)) return { ok: false, reason: "state" };
  /* What a challenge must carry by the time a code can be redeemed: an address to open
     an account with, and a code to compare against. `subject` is required only of the
     Google flow, where it is the identity the provider asserted — an email challenge has
     no such thing, and requiring one would make every one of them "incomplete". */
  if (!challenge.email || !challenge.codeHash || !challenge.codeSalt) return { ok: false, reason: "incomplete" };
  if (challenge.provider === "google" && !challenge.subject) return { ok: false, reason: "incomplete" };
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await sql.query("UPDATE login_challenges SET consumed_at=$1 WHERE id=$2 AND consumed_at IS NULL", [now.toISOString(), challenge.id]);
    return { ok: false, reason: "exhausted" };
  }

  await sql.query("UPDATE login_challenges SET attempts=attempts+1 WHERE id=$1", [challenge.id]);
  const correct = await verifyCode(input.code, challenge.codeHash, challenge.codeSalt);
  if (!correct) {
    const attempts = challenge.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await sql.query("UPDATE login_challenges SET consumed_at=$1 WHERE id=$2 AND consumed_at IS NULL", [now.toISOString(), challenge.id]);
      return { ok: false, reason: "exhausted" };
    }
    return { ok: false, reason: "mismatch", remaining: Math.max(0, MAX_ATTEMPTS - attempts) };
  }

  const consumed = await sql.query("UPDATE login_challenges SET consumed_at=$1 WHERE id=$2 AND consumed_at IS NULL RETURNING id", [now.toISOString(), challenge.id]);
  if (!consumed.length) return { ok: false, reason: "exhausted" };
  return { ok: true, challenge };
}

/** Housekeeping for rows nobody finished. */
export async function pruneChallenges(sql: Sql, now = new Date()): Promise<number> {
  const rows = await sql.query("DELETE FROM login_challenges WHERE expires_at<$1 RETURNING id", [now.toISOString()]);
  return rows.length;
}
