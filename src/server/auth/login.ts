import { randomUUID } from "node:crypto";
import { LOCAL_WORKSPACE_ID, type Database, type Sql } from "../database";
import { AppError } from "../service";
import { isAllowedEmail, requireAuthConfig } from "./config";
import { authorizationUrl, exchangeCode } from "./google";
import { bindIdentity, challengeForCallback, CODE_TTL_MS, consumeCode, createChallenge, createEmailChallenge, noteSend } from "./challenges";
import { createMailer, loginCodeMessage, type Mailer } from "./mail";
import { recordEvent, type AuthEventKind } from "./events";
import { hashCode, normalizeEmail, randomCode, sha256 } from "./tokens";
import { mintSession } from "./session-store";

/**
 * The two-step login, orchestrated.
 *
 * Network calls deliberately sit *outside* database transactions. The SQLite adapter
 * serialises every transaction behind one queue and the Postgres path takes a global
 * advisory lock, so holding either open across a ten-second Google round trip would
 * stall every other request in the process. Each step therefore reads, releases, acts,
 * then re-checks and writes — and the second write re-validates rather than trusting
 * what the first read saw.
 */
export const CODE_MINUTES = CODE_TTL_MS / 60_000;

export type BeginLoginResult = { url: string; challengeId: string; state: string };

export async function beginLogin(database: Database, now = new Date()): Promise<BeginLoginResult> {
  const config = requireAuthConfig();
  // Google is an optional second factor now. Asking for it on a deployment that has no
  // client is a configuration answer, not a crash: the route renders it as a 503 naming
  // the two variables, the same way every other unconfigured piece does.
  if (!config.hasGoogle) throw new AppError(503, "google_not_configured", "Google sign-in is not configured on this server. Use the emailed code instead.");
  const challenge = await database.transaction((sql) => createChallenge(sql, now));
  return { url: authorizationUrl(config, { state: challenge.state, verifier: challenge.verifier }), challengeId: challenge.id, state: challenge.state };
}

export type StartEmailResult = { challengeId: string; state: string; email: string; expiresAt: string };

/**
 * Step one of the sign-in this installation actually uses: an address, and nothing else.
 *
 * Two checks stand between the form and an email in somebody's inbox, and they answer
 * different questions. The allowlist is the operator saying *who may ever* sign in; the
 * account row is this installation saying *you already have somewhere to put your notes*.
 * Both are required, and the second is not created here — an allowlist is a string in a
 * deployment's environment, and a typo in it should not quietly mint a workspace.
 *
 * No code is generated until both pass. A code that is emailed and then refused is a
 * live credential sitting in a mailbox for no reason, and it teaches the person that the
 * email was the part that failed.
 */
export async function startEmailLogin(
  database: Database,
  input: { email: string; ip: string | null; now?: Date; mailer?: Mailer },
): Promise<StartEmailResult> {
  const config = requireAuthConfig();
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AppError(400, "invalid_email", "That is not an email address.");

  if (!isAllowedEmail(email, config.allowedEmails)) {
    await database.transaction((sql) => recordEvent(sql, { kind: "login_not_allowlisted", email, ip: input.ip }, now));
    throw new AppError(403, "not_allowed", "That address is not allowed to use this Raspberry.");
  }

  const account = await database.transaction((sql) => existingAccount(sql, email, now));
  if (!account) {
    await database.transaction((sql) => recordEvent(sql, { kind: "login_no_account", email, ip: input.ip }, now));
    throw new AppError(403, "no_account", "No Raspberry account exists for that address yet. Ask for one to be created.");
  }

  const code = randomCode();
  const challenge = await database.transaction((sql) => createEmailChallenge(sql, { email, code, now }));

  const mailer = input.mailer ?? createMailer(config);
  try {
    await mailer({ to: email, subject: `Your Raspberry code: ${code}`, text: loginCodeMessage(code, CODE_MINUTES) });
  } catch (error) {
    await database.transaction((sql) => recordEvent(sql, { kind: "mail_failed", email, ip: input.ip }, now));
    throw error;
  }
  await database.transaction((sql) => recordEvent(sql, { kind: "login_code_sent", email, ip: input.ip, detail: "email" }, now));

  return { challengeId: challenge.id, state: challenge.state, email, expiresAt: challenge.expiresAt };
}

export type CallbackInput = {
  challengeId: string;
  state: string;
  code: string;
  ip: string | null;
  now?: Date;
  fetchImpl?: typeof fetch;
  mailer?: Mailer;
};

/**
 * Google has returned. Validate the round trip, prove the identity, email a code.
 *
 * Returns only the challenge id; the browser never sees the code.
 */
export async function completeCallback(database: Database, input: CallbackInput): Promise<{ challengeId: string }> {
  const config = requireAuthConfig();
  const now = input.now ?? new Date();

  const loaded = await database.transaction((sql) =>
    challengeForCallback(sql, { id: input.challengeId, state: input.state, now }).then(async (result) => {
      if (!result.ok) await recordEvent(sql, { kind: "login_state_rejected", ip: input.ip, detail: result.reason }, now);
      return result;
    }),
  );
  if (!loaded.ok) throw new AppError(400, "login_expired", "That sign-in attempt expired. Start again.");

  const identity = await exchangeCode(config, { code: input.code, verifier: loaded.challenge.pkceVerifier }, input.fetchImpl ?? fetch);

  if (!identity.emailVerified) {
    await database.transaction((sql) => recordEvent(sql, { kind: "login_email_unverified", email: identity.email, ip: input.ip }, now));
    throw new AppError(403, "email_unverified", "That Google account has no verified email address.");
  }
  if (!isAllowedEmail(identity.email, config.allowedEmails)) {
    await database.transaction((sql) => recordEvent(sql, { kind: "login_not_allowlisted", email: identity.email, ip: input.ip }, now));
    throw new AppError(403, "not_allowed", "This account is not allowed to use this Raspberry.");
  }

  const code = randomCode();
  const bound = await database.transaction(async (sql) => {
    const [row] = await sql.query("SELECT consumed_at, expires_at FROM login_challenges WHERE id=$1", [loaded.challenge.id]);
    // Re-checked: the exchange above took time and the row can be consumed or expired
    // meanwhile. A stale read here would hand out a second code for one attempt.
    if (!row || row.consumed_at != null || now.toISOString() >= String(row.expires_at)) return false;
    await bindIdentity(sql, { id: loaded.challenge.id, subject: identity.subject, email: identity.email, displayName: identity.name, code, now });
    await recordEvent(sql, { kind: "login_code_sent", email: identity.email, ip: input.ip }, now);
    return true;
  });
  if (!bound) throw new AppError(400, "login_expired", "That sign-in attempt expired. Start again.");

  const mailer = input.mailer ?? createMailer(config);
  try {
    await mailer({ to: identity.email, subject: `Your Raspberry code: ${code}`, text: loginCodeMessage(code, CODE_MINUTES) });
  } catch (error) {
    await database.transaction((sql) => recordEvent(sql, { kind: "mail_failed", email: identity.email, ip: input.ip }, now));
    throw error;
  }

  return { challengeId: loaded.challenge.id };
}

/** Re-sends within the cooldown and send cap. Returns the fresh code to mail. */
export async function resendCode(database: Database, input: { challengeId: string; ip: string | null; now?: Date; mailer?: Mailer }): Promise<void> {
  const config = requireAuthConfig();
  const now = input.now ?? new Date();

  const outcome = await database.transaction(async (sql) => {
    const allowed = await noteSend(sql, input.challengeId, now);
    if (allowed !== "ok") return { allowed, email: null as string | null };
    const [row] = await sql.query("SELECT email FROM login_challenges WHERE id=$1", [input.challengeId]);
    if (!row || row.email == null) return { allowed: "exhausted" as const, email: null };
    return { allowed, email: String(row.email) };
  });
  if (outcome.allowed === "cooldown") throw new AppError(429, "cooldown", "A code was just sent. Wait a minute before asking for another.");
  if (outcome.allowed !== "ok" || !outcome.email) throw new AppError(400, "login_expired", "That sign-in attempt expired. Start again.");

  const code = randomCode();
  const { hash, salt } = await hashCode(code);
  await database.transaction((sql) =>
    sql.query("UPDATE login_challenges SET code_hash=$1, code_salt=$2, attempts=0 WHERE id=$3 AND consumed_at IS NULL", [hash, salt, input.challengeId]),
  );

  const mailer = input.mailer ?? createMailer(config);
  await mailer({ to: outcome.email, subject: `Your Raspberry code: ${code}`, text: loginCodeMessage(code, CODE_MINUTES) });
}

export type LoginInput = { challengeId: string; code: string; state?: string; ip: string | null; userAgent: string | null; now?: Date };

export type LoginResult = { token: string; sessionId: string; userId: string; absoluteExpiresAt: string };

/**
 * The second factor. Verifies the code, resolves the account, and mints the session —
 * all in one transaction, so a code is never consumed without a session and a session is
 * never minted for an unverified code.
 *
 * Which account it resolves depends on how the identity was established. A code that
 * arrived from the email-only flow opens an account that already exists and refuses to
 * invent one; the Google flow keeps provisioning, because there the workspace was
 * promised to a named owner address and the provider has already vouched for it.
 */
export async function completeLogin(database: Database, input: LoginInput): Promise<LoginResult> {
  const config = requireAuthConfig();
  const now = input.now ?? new Date();

  // Failure is returned, not thrown, from inside the transaction: throwing would roll
  // back the very audit row that records the rejection. The transaction commits first,
  // and the caller sees an error only afterwards.
  const outcome = await database.transaction(async (sql) => {
    const result = await consumeCode(sql, { id: input.challengeId, code: input.code, state: input.state, now });
    if (!result.ok) {
      const failure = codeFailure(result.reason, result.reason === "mismatch" ? result.remaining : undefined);
      await recordEvent(sql, { kind: failure.event, ip: input.ip, detail: result.reason }, now);
      return { ok: false as const, error: failure.error };
    }
    const email = result.challenge.email ?? "";
    const subject = result.challenge.subject ?? "";
    // Re-checked at the second factor too: the allowlist can change while a code is
    // live, and the answer should follow the list, not the session.
    if (!isAllowedEmail(email, config.allowedEmails)) {
      await recordEvent(sql, { kind: "login_not_allowlisted", email, ip: input.ip }, now);
      return { ok: false as const, error: new AppError(403, "not_allowed", "This account is not allowed to use this Raspberry.") };
    }

    /* The address was allowlisted a moment ago or this code was never sent, so the two
       refusals below are not the same thing. One says "someone with the right to run
       this server decided you are not on the list"; the other says "you are on the list
       and there is nothing here for you yet, because an account is made deliberately and
       not by whoever reaches the form first". Saying so costs a little enumeration on a
       two-person installation; saying nothing costs the operator an hour of staring at a
       mailbox that is working perfectly. */
    let account: Account;
    if (result.challenge.provider === "email") {
      const existing = await existingAccount(sql, email, now);
      if (!existing) {
        await recordEvent(sql, { kind: "login_no_account", email, ip: input.ip }, now);
        return {
          ok: false as const,
          error: new AppError(403, "no_account", "No Raspberry account exists for that address yet. Ask for one to be created."),
        };
      }
      account = existing;
    } else {
      account = await ensureAccount(sql, { subject, email, displayName: result.challenge.displayName }, now);
    }

    const session = await mintSession(sql, {
      userId: account.userId,
      workspaceId: account.workspaceId,
      ipHash: input.ip ? sha256(input.ip) : null,
      userAgentHash: input.userAgent ? sha256(input.userAgent) : null,
      now,
    });
    await recordEvent(sql, { kind: "login_succeeded", email, ip: input.ip, detail: account.created ? "account_created" : "account_existing" }, now);
    return { ok: true as const, token: session.token, sessionId: session.sessionId, userId: account.userId, absoluteExpiresAt: session.absoluteExpiresAt };
  });

  if (!outcome.ok) throw outcome.error;
  return { token: outcome.token, sessionId: outcome.sessionId, userId: outcome.userId, absoluteExpiresAt: outcome.absoluteExpiresAt };
}

function codeFailure(
  reason: "unknown" | "expired" | "incomplete" | "exhausted" | "state" | "mismatch",
  remaining?: number,
): { error: AppError; event: AuthEventKind } {
  switch (reason) {
    case "expired":
      return { error: new AppError(400, "code_expired", "That code expired. Start again to get a new one."), event: "login_code_expired" };
    case "exhausted":
      return { error: new AppError(429, "code_exhausted", "Too many incorrect codes. Start again to get a new one."), event: "login_code_exhausted" };
    /* A cookie that does not match the challenge means the code was issued to a
       different browser than the one typing it. That is indistinguishable from an
       expired attempt as far as the person is concerned, and it is recorded as a
       rejected state so the audit log shows an attempt without the id.
       The code is **not** consumed: see `consumeCode`. */
    case "state":
      return { error: new AppError(400, "login_expired", "That sign-in attempt expired. Start again."), event: "login_state_rejected" };
    case "mismatch":
      return {
        error: new AppError(
          400,
          "code_wrong",
          remaining == null ? "That code is not correct." : `That code is not correct. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`,
        ),
        event: "login_code_wrong",
      };
    default:
      return { error: new AppError(400, "login_expired", "That sign-in attempt expired. Start again."), event: "login_code_expired" };
  }
}

export type Account = { userId: string; workspaceId: string; created: boolean };

/**
 * Whether this sign-in should adopt the notes that already exist on this machine.
 *
 * Requires `RASPBERRY_OWNER_EMAIL` to be set and to match exactly. With it unset, nobody
 * adopts anything and every account gets its own workspace — the safe default, because
 * the alternative reading of a missing value would be "the first person to sign in gets
 * the existing notes".
 */
export function claimableLocalWorkspace(email: string, configured = process.env.RASPBERRY_OWNER_EMAIL): boolean {
  const owner = (configured ?? "").trim().toLowerCase();
  return owner.length > 0 && owner === email.trim().toLowerCase();
}

/**
 * The account an address already owns, or nothing.
 *
 * Matched on the address rather than on a provider subject, because the emailed code is
 * the only thing proving identity here — there is no provider to ask. `disabled_at`
 * matters: revoking access has to mean something, and an account row that was switched
 * off must not be reachable by a code that would otherwise be valid.
 *
 * The workspace is picked the way `ensureAccount` picks it, owner membership first, so a
 * person who belongs to more than one lands in the same one every time rather than in
 * whichever the planner happens to return.
 */
export async function existingAccount(sql: Sql, email: string, _now: Date): Promise<Account | null> {
  const [account] = await sql.query("SELECT user_id FROM accounts WHERE email=$1 AND disabled_at IS NULL ORDER BY created_at LIMIT 1", [email]);
  if (!account) return null;
  const userId = String(account.user_id);
  const [membership] = await sql.query(
    "SELECT workspace_id FROM memberships WHERE user_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, workspace_id LIMIT 1",
    [userId],
  );
  if (!membership) throw new AppError(403, "no_workspace", "That account has no workspace. Ask for access to be re-granted.");
  return { userId, workspaceId: String(membership.workspace_id), created: false };
}

/**
 * Finds or creates the local account for a provider identity.
 *
 * A single-owner installation still provisions a workspace per user id rather than
 * writing into `LOCAL_WORKSPACE_ID`: sharing the local workspace would mean a login
 * silently inheriting whatever the demo data happened to be, and would turn "copy the
 * database to the server" into an implicit side effect of signing in.
 */
export async function ensureAccount(
  sql: Sql,
  identity: { subject: string; email: string; displayName: string | null },
  now: Date,
): Promise<Account> {
  const [existing] = await sql.query("SELECT user_id FROM accounts WHERE provider='google' AND subject=$1", [identity.subject]);
  if (existing) {
    const userId = String(existing.user_id);
    await sql.query("UPDATE accounts SET email=$1, display_name=$2, last_login_at=$3 WHERE provider='google' AND subject=$4", [
      identity.email,
      identity.displayName,
      now.toISOString(),
      identity.subject,
    ]);
    const [membership] = await sql.query("SELECT workspace_id FROM memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 1", [userId]);
    if (!membership) throw new AppError(403, "no_workspace", "That account has no workspace. Ask for access to be re-granted.");
    return { userId, workspaceId: String(membership.workspace_id), created: false };
  }

  const userId = randomUUID();
  const workspaceId = randomUUID();

  // Claiming the existing local notes before creating a new workspace, and only for the
  // address the operator named. Without this, the first real sign-in on a machine that
  // already has `data/raspberry.sqlite` would provision a fresh empty workspace and the
  // notes written until now would be unreachable behind any account.
  //
  // Scoped to `LOCAL_WORKSPACE_ID` specifically, never to "any workspace with an owner",
  // so this cannot become a way to adopt somebody else's pages.
  if (claimableLocalWorkspace(identity.email)) {
    const [owner] = await sql.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND role='owner' LIMIT 1", [LOCAL_WORKSPACE_ID]);
    if (owner) {
      const adopted = String(owner.user_id);
      await sql.query("UPDATE users SET display_name=$1 WHERE id=$2", [identity.displayName ?? identity.email, adopted]);
      await sql.query("INSERT INTO accounts(id,user_id,provider,subject,email,display_name,created_at,last_login_at) VALUES($1,$2,'google',$3,$4,$5,$6,$6)", [
        randomUUID(),
        adopted,
        identity.subject,
        identity.email,
        identity.displayName,
        now.toISOString(),
      ]);
      return { userId: adopted, workspaceId: LOCAL_WORKSPACE_ID, created: true };
    }
  }

  await sql.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, identity.displayName ?? identity.email]);
  await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspaceId, "Personal workspace"]);
  await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')", [userId, workspaceId]);
  await sql.query("INSERT INTO accounts(id,user_id,provider,subject,email,display_name,created_at,last_login_at) VALUES($1,$2,'google',$3,$4,$5,$6,$6)", [
    randomUUID(),
    userId,
    identity.subject,
    identity.email,
    identity.displayName,
    now.toISOString(),
  ]);
  return { userId, workspaceId, created: true };
}
