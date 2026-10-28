import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../database";
import { equalHex, randomToken, sha256 } from "./tokens";

/**
 * Opaque server-side sessions.
 *
 * The cookie carries `<sessionId>.<secret>`. Only SHA-256 of the secret is stored,
 * so a database copy cannot be replayed as a login. There is no signing key: a
 * stateless token would still need a database read per request to honour
 * revocation, so it would buy nothing and add a secret that can leak.
 *
 * Two clocks run at once. `idle_expires_at` slides forward while the session is
 * used; `absolute_expires_at` never moves, so a tab left open cannot extend a
 * session forever.
 */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Refreshing on every request would make every read a write. */
export const SESSION_TOUCH_MS = 60 * 1000;

export type Role = "owner" | "editor" | "viewer";
const roles: readonly Role[] = ["owner", "editor", "viewer"];

export type SessionRecord = {
  sessionId: string;
  userId: string;
  workspaceId: string;
  role: Role;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

export type MintedSession = { token: string; sessionId: string; idleExpiresAt: string; absoluteExpiresAt: string };

export type VerifyFailure = "malformed" | "unknown" | "expired" | "revoked" | "membership";
export type VerifyResult = { ok: true; session: SessionRecord; touched: boolean } | { ok: false; reason: VerifyFailure };

export const cookieToken = (sessionId: string, secret: string): string => `${sessionId}.${secret}`;

/** Splits `<uuid>.<secret>` without touching the database for obvious garbage. */
export function parseToken(token: string): { sessionId: string; secret: string } | null {
  if (typeof token !== "string") return null;
  const separator = token.indexOf(".");
  if (separator === -1) return null;
  const sessionId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  if (secret.length < 32 || secret.length > 128) return null;
  return { sessionId, secret };
}

/**
 * Creates a session. Takes `sql` rather than a `Database` so it can join the
 * transaction that just created the account: an account without a session, or a
 * session for an account that was rolled back, would both be wrong.
 */
export async function mintSession(
  sql: Sql,
  input: { userId: string; workspaceId: string; ipHash?: string | null; userAgentHash?: string | null; now?: Date },
): Promise<MintedSession> {
  const now = input.now ?? new Date();
  const sessionId = randomUUID();
  const secret = randomToken();
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS).toISOString();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString();
  await sql.query(
    "INSERT INTO sessions(id,token_hash,user_id,workspace_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at,ip_hash,user_agent_hash) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)",
    [sessionId, sha256(secret), input.userId, input.workspaceId, now.toISOString(), idleExpiresAt, absoluteExpiresAt, input.ipHash ?? null, input.userAgentHash ?? null],
  );
  return { token: cookieToken(sessionId, secret), sessionId, idleExpiresAt, absoluteExpiresAt };
}

/**
 * Resolves a cookie value to a session, or says precisely why not.
 *
 * The role comes from `memberships` on every call, not from the session row: an
 * access downgrade has to take effect on the next request, not the next login.
 * A session whose membership has disappeared is refused rather than defaulted,
 * which is what closes the gap if a workspace is ever deleted.
 */
export async function verifySession(
  database: Database,
  token: string,
  options: { now?: Date; touch?: boolean } = {},
): Promise<VerifyResult> {
  const parsed = parseToken(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  const now = options.now ?? new Date();
  const touch = options.touch ?? true;

  return database.transaction(async (sql) => {
    // LEFT JOIN, not JOIN: a deleted membership must report `membership` rather than
    // vanishing into `unknown`, because the two mean different things in a log — one
    // is a valid session for an account that lost access, the other is a bad token.
    const [row] = await sql.query(
      "SELECT s.id, s.token_hash, s.user_id, s.workspace_id, s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at, s.revoked_at, m.role FROM sessions s LEFT JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id WHERE s.id=$1",
      [parsed.sessionId],
    );
    if (!row) return { ok: false, reason: "unknown" } as const;
    if (!equalHex(sha256(parsed.secret), String(row.token_hash))) return { ok: false, reason: "unknown" } as const;
    if (row.revoked_at != null) return { ok: false, reason: "revoked" } as const;

    const absoluteExpiresAt = String(row.absolute_expires_at);
    const idleExpiresAt = String(row.idle_expires_at);
    const nowIso = now.toISOString();
    if (nowIso >= absoluteExpiresAt) return { ok: false, reason: "expired" } as const;
    if (nowIso >= idleExpiresAt) return { ok: false, reason: "expired" } as const;

    const role = roles.includes(row.role as Role) ? (row.role as Role) : null;
    if (!role) return { ok: false, reason: "membership" } as const;

    const session: SessionRecord = {
      sessionId: String(row.id),
      userId: String(row.user_id),
      workspaceId: String(row.workspace_id),
      role,
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
      idleExpiresAt,
      absoluteExpiresAt,
    };

    const due = now.getTime() - new Date(session.lastSeenAt).getTime() >= SESSION_TOUCH_MS;
    if (!touch || !due) return { ok: true, session, touched: false } as const;

    const nextIdle = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, new Date(absoluteExpiresAt).getTime())).toISOString();
    await sql.query("UPDATE sessions SET last_seen_at=$1, idle_expires_at=$2 WHERE id=$3", [nowIso, nextIdle, session.sessionId]);
    return { ok: true, session: { ...session, lastSeenAt: nowIso, idleExpiresAt: nextIdle }, touched: true } as const;
  });
}

export async function revokeSession(database: Database, sessionId: string, reason = "logout", now = new Date()): Promise<boolean> {
  return database.transaction(async (sql) => {
    const rows = await sql.query("UPDATE sessions SET revoked_at=$1, revoked_reason=$2 WHERE id=$3 AND revoked_at IS NULL RETURNING id", [now.toISOString(), reason, sessionId]);
    return rows.length > 0;
  });
}

export async function revokeAllForUser(database: Database, userId: string, reason = "revoked", now = new Date()): Promise<number> {
  return database.transaction(async (sql) => {
    const rows = await sql.query("UPDATE sessions SET revoked_at=$1, revoked_reason=$2 WHERE user_id=$3 AND revoked_at IS NULL RETURNING id", [now.toISOString(), reason, userId]);
    return rows.length;
  });
}

/** Expired rows are deleted rather than kept, so the table cannot grow forever. */
export async function pruneSessions(database: Database, now = new Date()): Promise<number> {
  return database.transaction(async (sql) => {
    const rows = await sql.query("DELETE FROM sessions WHERE idle_expires_at<$1 OR absolute_expires_at<$1 RETURNING id", [now.toISOString()]);
    return rows.length;
  });
}
