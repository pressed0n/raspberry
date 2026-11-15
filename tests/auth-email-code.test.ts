import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../src/server/database";
import { AppError } from "../src/server/service";
import { openMigrated } from "./schema";
import { startEmailLogin, completeLogin, CODE_MINUTES } from "../src/server/auth/login";
import { verifySession } from "../src/server/auth/session-store";

/* Deliberately no `GOOGLE_CLIENT_ID`. The whole point of this file is that sign-in works
   without one, and a fixture that quietly set them would prove the opposite. */
process.env.RASPBERRY_PUBLIC_ORIGIN = "https://raspberry.test";
process.env.RASPBERRY_ALLOWED_EMAILS = "Owner@Example.com, second@example.com";
process.env.RASPBERRY_MAIL_BACKEND = "console";
process.env.RASPBERRY_MAIL_FROM = "raspberry@raspberry.test";
delete process.env.RASPBERRY_OWNER_EMAIL;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const OWNER = "owner@example.com";
const SECOND = "second@example.com";
const STRANGER = "stranger@example.com";

type Captured = { to: string; text: string };

function mailer(captured: Captured[]) {
  return async (message: { to: string; subject: string; text: string }) => {
    captured.push({ to: message.to, text: message.text });
  };
}

const codeFrom = (text: string): string => {
  const match = text.match(/\b(\d{6})\b/);
  assert.ok(match, `expected a six digit code in ${JSON.stringify(text)}`);
  return match[1];
};

/** A user, a workspace, and the `accounts` row that lets the address sign in. */
async function seedAccount(database: Database, email: string, options: { disabled?: boolean } = {}): Promise<{ userId: string; workspaceId: string }> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await database.transaction(async (sql: Sql) => {
    await sql.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, email]);
    await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspaceId, "Personal workspace"]);
    await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')", [userId, workspaceId]);
    await sql.query("INSERT INTO accounts(id,user_id,provider,subject,email,display_name,created_at,disabled_at) VALUES($1,$2,'email',$3,$4,$5,$6,$7)", [
      randomUUID(),
      userId,
      email,
      email,
      null,
      new Date(0).toISOString(),
      options.disabled ? new Date(0).toISOString() : null,
    ]);
  });
  return { userId, workspaceId };
}

const count = async (database: Database, table: string): Promise<number> => {
  const [row] = await database.transaction((sql) => sql.query(`SELECT count(*) AS n FROM ${table}`));
  return Number(row?.n ?? 0);
};

test("an allowlisted address with an account gets a six-digit code that expires in five minutes", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const now = new Date("2026-01-01T00:00:00.000Z");

  const started = await startEmailLogin(database, { email: "Owner@Example.COM", ip: "203.0.113.9", now, mailer: mailer(captured) });

  assert.equal(captured.length, 1, "exactly one email");
  assert.equal(captured[0].to, OWNER, "mailed to the normalized address, not the one typed");
  assert.match(codeFrom(captured[0].text), /^\d{6}$/);
  // Five minutes, counted from the moment the code was sent — the screen says five and
  // the row has to agree with the sentence.
  assert.equal(started.expiresAt, "2026-01-01T00:05:00.000Z");
  assert.equal(CODE_MINUTES, 5);
  assert.equal(started.email, OWNER);

  const [challenge] = await database.transaction((sql) => sql.query("SELECT provider,email,google_sub,code_hash FROM login_challenges WHERE id=$1", [started.challengeId]));
  assert.equal(challenge?.provider, "email");
  assert.equal(challenge?.email, OWNER);
  assert.equal(challenge?.google_sub, null, "an email challenge asserts no provider subject");
  assert.notEqual(challenge?.code_hash, codeFrom(captured[0].text), "the code is never stored in a replayable form");
});

test("a whitelisted address with no account is refused, and nothing is emailed", async () => {
  const database = await openMigrated();
  const captured: Captured[] = [];

  await assert.rejects(
    () => startEmailLogin(database, { email: SECOND, ip: null, mailer: mailer(captured) }),
    (error: unknown) => error instanceof AppError && error.code === "no_account" && error.status === 403,
  );
  assert.equal(captured.length, 0, "no code is minted for an address that can never be let in");
  assert.equal(await count(database, "login_challenges"), 0);
});

test("an address that is not on the allowlist is refused before anything else happens", async () => {
  const database = await openMigrated();
  // Even with an account row, the allowlist is the outer gate.
  await seedAccount(database, STRANGER);
  const captured: Captured[] = [];

  await assert.rejects(
    () => startEmailLogin(database, { email: STRANGER, ip: null, mailer: mailer(captured) }),
    (error: unknown) => error instanceof AppError && error.code === "not_allowed",
  );
  assert.equal(captured.length, 0);
  assert.equal(await count(database, "login_challenges"), 0);
});

test("a disabled account cannot be signed in, whatever the allowlist says", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER, { disabled: true });

  await assert.rejects(
    () => startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer([]) }),
    (error: unknown) => error instanceof AppError && error.code === "no_account",
  );
});

test("the right code signs in to the account's own workspace", async () => {
  const database = await openMigrated();
  const { userId, workspaceId } = await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const started = await startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer(captured) });

  const login = await completeLogin(database, {
    challengeId: started.challengeId,
    code: codeFrom(captured[0].text),
    state: started.state,
    ip: null,
    userAgent: "node-test",
  });

  assert.equal(login.userId, userId);
  const session = await verifySession(database, login.token);
  assert.ok(session.ok, "the session token is valid");
  if (session.ok) assert.equal(session.session.workspaceId, workspaceId);
});

test("the code is single use: the second attempt is refused", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const started = await startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer(captured) });
  const code = codeFrom(captured[0].text);

  await completeLogin(database, { challengeId: started.challengeId, code, state: started.state, ip: null, userAgent: null });
  await assert.rejects(
    () => completeLogin(database, { challengeId: started.challengeId, code, state: started.state, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_exhausted",
  );
});

test("five wrong attempts burn the code, and the sixth is refused without another guess", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const started = await startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer(captured) });
  const real = codeFrom(captured[0].text);
  const wrong = real === "000000" ? "111111" : "000000";

  // Four refusals that still leave the code alive, then the fifth spends the budget.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () => completeLogin(database, { challengeId: started.challengeId, code: wrong, state: started.state, ip: null, userAgent: null }),
      (error: unknown) => error instanceof AppError && error.code === "code_wrong",
      `attempt ${attempt} should be a wrong-code refusal`,
    );
  }
  await assert.rejects(
    () => completeLogin(database, { challengeId: started.challengeId, code: wrong, state: started.state, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_exhausted",
    "the fifth wrong attempt burns the code",
  );
  await assert.rejects(
    () => completeLogin(database, { challengeId: started.challengeId, code: real, state: started.state, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_exhausted",
    "the real code does not work once the budget is spent",
  );
});

test("after five minutes the code is expired, not merely wrong", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const now = new Date("2026-01-01T00:00:00.000Z");
  const started = await startEmailLogin(database, { email: OWNER, ip: null, now, mailer: mailer(captured) });

  await assert.rejects(
    () =>
      completeLogin(database, {
        challengeId: started.challengeId,
        code: codeFrom(captured[0].text),
        state: started.state,
        ip: null,
        userAgent: null,
        now: new Date("2026-01-01T00:05:00.000Z"),
      }),
    (error: unknown) => error instanceof AppError && error.code === "code_expired",
  );
});

test("a cookie from another browser is refused, and the code is not spent by the attempt", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const started = await startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer(captured) });
  const code = codeFrom(captured[0].text);

  await assert.rejects(
    () => completeLogin(database, { challengeId: started.challengeId, code, state: "x".repeat(43), ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "login_expired",
  );
  const [row] = await database.transaction((sql) => sql.query("SELECT attempts,consumed_at FROM login_challenges WHERE id=$1", [started.challengeId]));
  assert.equal(Number(row?.attempts), 0, "a caller without the cookie has not earned a guess");
  assert.equal(row?.consumed_at, null);

  // And the person who does hold the cookie is still able to sign in.
  const login = await completeLogin(database, { challengeId: started.challengeId, code, state: started.state, ip: null, userAgent: null });
  assert.ok(login.token);
});

test("an email challenge never creates an account, even if one vanishes between the two steps", async () => {
  const database = await openMigrated();
  const { userId } = await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const started = await startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer(captured) });

  // The account is revoked while the code is live. The code was valid when it was sent;
  // it must not be a way back in.
  await database.transaction((sql) => sql.query("UPDATE accounts SET disabled_at=$1 WHERE user_id=$2", [new Date().toISOString(), userId]));
  const usersBefore = await count(database, "users");

  await assert.rejects(
    () => completeLogin(database, { challengeId: started.challengeId, code: codeFrom(captured[0].text), state: started.state, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "no_account",
  );
  assert.equal(await count(database, "users"), usersBefore, "no account was provisioned on the way out");
});

test("the allowlist is re-read at the second step, not trusted from the first", async () => {
  const database = await openMigrated();
  await seedAccount(database, OWNER);
  const captured: Captured[] = [];
  const started = await startEmailLogin(database, { email: OWNER, ip: null, mailer: mailer(captured) });

  process.env.RASPBERRY_ALLOWED_EMAILS = SECOND;
  try {
    await assert.rejects(
      () => completeLogin(database, { challengeId: started.challengeId, code: codeFrom(captured[0].text), state: started.state, ip: null, userAgent: null }),
      (error: unknown) => error instanceof AppError && error.code === "not_allowed",
    );
  } finally {
    process.env.RASPBERRY_ALLOWED_EMAILS = "Owner@Example.com, second@example.com";
  }
});
