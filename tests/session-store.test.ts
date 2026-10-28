import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, LOCAL_USER_ID, LOCAL_WORKSPACE_ID, type Database } from "../src/server/database";
import { migrate } from "../src/server/migrations";
import { RaspberryService } from "../src/server/service";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  mintSession,
  parseToken,
  pruneSessions,
  revokeAllForUser,
  revokeSession,
  verifySession,
} from "../src/server/auth/session-store";

async function fixture(): Promise<Database> {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  await new RaspberryService(database).seed();
  return database;
}

async function mint(database: Database, now?: Date): Promise<{ token: string; sessionId: string }> {
  return database.transaction((sql) => mintSession(sql, { userId: LOCAL_USER_ID, workspaceId: LOCAL_WORKSPACE_ID, now }));
}

test("a minted session resolves to its actor", async () => {
  const database = await fixture();
  const { token } = await mint(database);
  const result = await verifySession(database, token);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.userId, LOCAL_USER_ID);
  assert.equal(result.session.workspaceId, LOCAL_WORKSPACE_ID);
  assert.equal(result.session.role, "owner");
});

test("the raw secret is never stored", async () => {
  const database = await fixture();
  const { token } = await mint(database);
  const secret = parseToken(token)?.secret;
  assert.ok(secret);
  const rows = await database.transaction((sql) => sql.query<{ token_hash: string }>("SELECT token_hash FROM sessions"));
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, secret);
  assert.match(String(rows[0].token_hash), /^[0-9a-f]{64}$/, "only a SHA-256 digest is persisted");
});

test("malformed tokens are refused without a database read", async () => {
  const database = await fixture();
  for (const token of ["", "no-separator", "not-a-uuid.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", `${crypto.randomUUID()}.short`]) {
    const result = await verifySession(database, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "malformed", `expected malformed for ${JSON.stringify(token)}`);
  }
});

test("an unknown session id or a wrong secret is unknown, never expired", async () => {
  const database = await fixture();
  const { token, sessionId } = await mint(database);
  assert.equal((await verifySession(database, `${crypto.randomUUID()}.${parseToken(token)?.secret}`)).ok, false);

  const wrongSecret = await verifySession(database, `${sessionId}.${"A".repeat(43)}`);
  assert.equal(wrongSecret.ok, false);
  if (!wrongSecret.ok) assert.equal(wrongSecret.reason, "unknown");
});

test("an idle session expires", async () => {
  const database = await fixture();
  const created = new Date();
  const { token } = await mint(database, created);
  const later = new Date(created.getTime() + SESSION_IDLE_MS + 1000);
  const result = await verifySession(database, token, { now: later, touch: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "expired");
});

test("the absolute lifetime cannot be extended by activity", async () => {
  const database = await fixture();
  const created = new Date();
  const { token, sessionId } = await mint(database, created);
  // Idle window pushed far into the future, absolute deadline unchanged.
  await database.transaction((sql) =>
    sql.query("UPDATE sessions SET idle_expires_at=$1 WHERE id=$2", [new Date(created.getTime() + SESSION_IDLE_MS * 10).toISOString(), sessionId]),
  );
  const result = await verifySession(database, token, { now: new Date(created.getTime() + SESSION_ABSOLUTE_MS + 1000) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "expired");
});

test("a live session is touched at most once a minute, and never past the absolute deadline", async () => {
  const database = await fixture();
  const created = new Date();
  const { token, sessionId } = await mint(database, created);

  const immediate = await verifySession(database, token, { now: created });
  assert.equal(immediate.ok, true);
  if (immediate.ok) assert.equal(immediate.touched, false, "an immediate re-read does not write");

  const fiveMinutes = new Date(created.getTime() + 5 * 60 * 1000);
  const slid = await verifySession(database, token, { now: fiveMinutes });
  assert.equal(slid.ok, true);
  if (slid.ok) {
    assert.equal(slid.touched, true);
    assert.equal(slid.session.lastSeenAt, fiveMinutes.toISOString());
    assert.equal(slid.session.idleExpiresAt, new Date(fiveMinutes.getTime() + SESSION_IDLE_MS).toISOString());
  }

  const rows = await database.transaction((sql) => sql.query<{ idle_expires_at: string; last_seen_at: string }>("SELECT idle_expires_at, last_seen_at FROM sessions WHERE id=$1", [sessionId]));
  assert.equal(String(rows[0].last_seen_at), fiveMinutes.toISOString());

  // Near the absolute deadline the idle window is clamped instead of extending it.
  // The idle deadline has to be pushed out first: a session last touched five minutes
  // after creation is idle-expired long before the absolute deadline arrives, so
  // without this the clamp would never be reached.
  const nearlyDone = new Date(created.getTime() + SESSION_ABSOLUTE_MS - 1000);
  await database.transaction((sql) => sql.query("UPDATE sessions SET idle_expires_at=$1 WHERE id=$2", [new Date(nearlyDone.getTime() + SESSION_IDLE_MS).toISOString(), sessionId]));
  const clamped = await verifySession(database, token, { now: nearlyDone });
  assert.equal(clamped.ok, true);
  if (clamped.ok) assert.equal(clamped.session.idleExpiresAt, clamped.session.absoluteExpiresAt);
});

test("a revoked session stops working, and revoking twice reports honestly", async () => {
  const database = await fixture();
  const { token, sessionId } = await mint(database);
  assert.equal(await revokeSession(database, sessionId), true);
  const result = await verifySession(database, token);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "revoked");
  assert.equal(await revokeSession(database, sessionId), false, "an already-revoked session is not counted twice");
});

test("losing membership invalidates the session instead of defaulting a role", async () => {
  const database = await fixture();
  const { token } = await mint(database);
  await database.transaction((sql) => sql.query("DELETE FROM memberships WHERE user_id=$1 AND workspace_id=$2", [LOCAL_USER_ID, LOCAL_WORKSPACE_ID]));
  const result = await verifySession(database, token);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "membership");
});

test("revoking every session for a user ends all of them", async () => {
  const database = await fixture();
  const first = await mint(database);
  const second = await mint(database);
  assert.equal(await revokeAllForUser(database, LOCAL_USER_ID), 2);
  for (const { token } of [first, second]) {
    const result = await verifySession(database, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "revoked");
  }
});

test("pruning deletes only sessions that are already dead", async () => {
  const database = await fixture();
  const live = await mint(database);
  const created = new Date(Date.now() - SESSION_ABSOLUTE_MS - 1000);
  await mint(database, created);
  assert.equal(await pruneSessions(database), 1);
  assert.equal((await verifySession(database, live.token)).ok, true);
});
