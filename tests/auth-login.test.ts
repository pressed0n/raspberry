import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, type Database } from "../src/server/database";
import { migrate } from "../src/server/migrations";
import { AppError } from "../src/server/service";
import { beginLogin, completeCallback, completeLogin, resendCode, type CallbackInput } from "../src/server/auth/login";
import { verifySession } from "../src/server/auth/session-store";
import { RaspberryService } from "../src/server/service";

process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";
process.env.RASPBERRY_PUBLIC_ORIGIN = "https://raspberry.test";
process.env.RASPBERRY_ALLOWED_EMAILS = "Owner@Example.com";
process.env.RASPBERRY_MAIL_BACKEND = "console";
process.env.RASPBERRY_MAIL_FROM = "raspberry@raspberry.test";

const ALLOWED = "owner@example.com";

async function fixture(): Promise<Database> {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  return database;
}

/** A Google stand-in: token exchange, then userinfo. Never touches the network. */
function google(options: { email?: string; verified?: boolean; subject?: string; tokenStatus?: number } = {}) {
  const email = options.email ?? ALLOWED;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /grant_type=authorization_code/);
      assert.match(String(init?.body), /code_verifier=/);
      if (options.tokenStatus && options.tokenStatus !== 200) return new Response("nope", { status: options.tokenStatus });
      return Response.json({ access_token: "access-token", token_type: "Bearer" });
    }
    if (url.includes("openidconnect.googleapis.com")) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer access-token");
      return Response.json({ sub: options.subject ?? "google-subject-1", email, email_verified: options.verified ?? true, name: "Owner" });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
}

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

async function startAndCallback(database: Database, overrides: Partial<CallbackInput> = {}): Promise<{ challengeId: string; captured: Captured[] }> {
  const begun = await beginLogin(database);
  const captured: Captured[] = [];
  const result = await completeCallback(database, {
    challengeId: begun.challengeId,
    state: begun.state,
    code: "authorization-code",
    ip: "203.0.113.9",
    fetchImpl: google(),
    mailer: mailer(captured),
    ...overrides,
  });
  return { challengeId: result.challengeId, captured };
}

test("beginLogin sends the browser to Google with PKCE and a state it can verify", async () => {
  const database = await fixture();
  const begun = await beginLogin(database);
  const url = new URL(begun.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://raspberry.test/api/auth/google/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), begun.state);
  assert.ok((url.searchParams.get("code_challenge") ?? "").length >= 43);

  const rows = await database.transaction((sql) => sql.query<{ state_hash: string; pkce_verifier: string }>("SELECT state_hash, pkce_verifier FROM login_challenges"));
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].state_hash, begun.state, "the raw state is not stored");
  assert.ok(rows[0].pkce_verifier.length >= 43);
});

test("a verified, allowlisted account is emailed a code and never receives a session yet", async () => {
  const database = await fixture();
  const { captured } = await startAndCallback(database);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].to, ALLOWED);
  assert.match(codeFrom(captured[0].text), /^\d{6}$/);
  const sessions = await database.transaction((sql) => sql.query("SELECT id FROM sessions"));
  assert.equal(sessions.length, 0, "the first factor must not create a session");
});

test("a mismatched state is refused and audited", async () => {
  const database = await fixture();
  const begun = await beginLogin(database);
  await assert.rejects(
    () => completeCallback(database, { challengeId: begun.challengeId, state: "a-different-state", code: "x", ip: null, fetchImpl: google(), mailer: mailer([]) }),
    (error: unknown) => error instanceof AppError && error.code === "login_expired",
  );
  const events = await database.transaction((sql) => sql.query<{ kind: string }>("SELECT kind FROM auth_events"));
  assert.deepEqual(events.map((row) => row.kind), ["login_state_rejected"]);
});

test("an unknown or already-consumed challenge is refused", async () => {
  const database = await fixture();
  await assert.rejects(
    () => completeCallback(database, { challengeId: crypto.randomUUID(), state: "s", code: "c", ip: null, fetchImpl: google(), mailer: mailer([]) }),
    (error: unknown) => error instanceof AppError && error.code === "login_expired",
  );

  // A challenge survives the callback on purpose — it has to, because the code is
  // entered afterwards. It ends when the code is used, and then cannot be started over.
  const used = await startAndCallback(database);
  await completeLogin(database, { challengeId: used.challengeId, code: codeFrom(used.captured[0].text), ip: null, userAgent: null });
  await assert.rejects(
    () => completeCallback(database, { challengeId: used.challengeId, state: "", code: "c", ip: null, fetchImpl: google(), mailer: mailer([]) }),
    (error: unknown) => error instanceof AppError && error.code === "login_expired",
  );
});

test("an expired challenge is refused", async () => {
  const database = await fixture();
  const begun = await beginLogin(database);
  await database.transaction((sql) => sql.query("UPDATE login_challenges SET expires_at=$1", ["2000-01-01T00:00:00.000Z"]));
  await assert.rejects(
    () => completeCallback(database, { challengeId: begun.challengeId, state: begun.state, code: "c", ip: null, fetchImpl: google(), mailer: mailer([]) }),
    (error: unknown) => error instanceof AppError && error.code === "login_expired",
  );
});

test("an account that is not on the allowlist gets nothing and is told so", async () => {
  const database = await fixture();
  const begun = await beginLogin(database);
  const captured: Captured[] = [];
  await assert.rejects(
    () =>
      completeCallback(database, {
        challengeId: begun.challengeId,
        state: begun.state,
        code: "c",
        ip: "198.51.100.4",
        fetchImpl: google({ email: "stranger@example.com" }),
        mailer: mailer(captured),
      }),
    (error: unknown) => error instanceof AppError && error.code === "not_allowed" && error.status === 403,
  );
  assert.equal(captured.length, 0, "no code is sent to a refused account");
  const events = await database.transaction((sql) => sql.query<{ kind: string }>("SELECT kind FROM auth_events"));
  assert.deepEqual(events.map((row) => row.kind), ["login_not_allowlisted"]);
});

test("an unverified Google email is refused", async () => {
  const database = await fixture();
  await assert.rejects(() => startAndCallback(database, { fetchImpl: google({ verified: false }) }), (error: unknown) => error instanceof AppError && error.code === "email_unverified");
});

test("a failed token exchange is a 502, not an admission", async () => {
  const database = await fixture();
  await assert.rejects(() => startAndCallback(database, { fetchImpl: google({ tokenStatus: 400 }) }), (error: unknown) => error instanceof AppError && error.code === "google_exchange_failed");
});

test("the right code mints a session in its own workspace", async () => {
  const database = await fixture();
  const { challengeId, captured } = await startAndCallback(database);
  const login = await completeLogin(database, { challengeId, code: codeFrom(captured[0].text), ip: "203.0.113.9", userAgent: "test-agent" });

  const verified = await verifySession(database, login.token, { touch: false });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.session.workspaceId === "00000000-0000-4000-8000-000000000002", false, "a login does not inherit the local demo workspace");
  assert.equal(verified.session.role, "owner");

  const events = await database.transaction((sql) => sql.query<{ kind: string; detail: string }>("SELECT kind, detail FROM auth_events ORDER BY at"));
  const success = events.find((row) => row.kind === "login_succeeded");
  assert.equal(success?.detail, "account_created");
  const sessions = await database.transaction((sql) => sql.query<{ ip_hash: string }>("SELECT ip_hash FROM sessions"));
  assert.equal(String(sessions[0].ip_hash).length, 64, "the IP is stored only as a digest");
});

test("signing in twice with the same Google account reuses the account and workspace", async () => {
  const database = await fixture();
  const first = await startAndCallback(database);
  const one = await completeLogin(database, { challengeId: first.challengeId, code: codeFrom(first.captured[0].text), ip: null, userAgent: null });

  const second = await startAndCallback(database);
  const two = await completeLogin(database, { challengeId: second.challengeId, code: codeFrom(second.captured[0].text), ip: null, userAgent: null });
  assert.equal(one.userId, two.userId);
  assert.notEqual(one.sessionId, two.sessionId, "each sign-in is its own session");

  const workspaces = await database.transaction((sql) => sql.query("SELECT id FROM workspaces"));
  assert.equal(workspaces.length, 1);
});

test("a wrong code counts down and a correct one still works within the budget", async () => {
  const database = await fixture();
  const { challengeId, captured } = await startAndCallback(database);
  const right = codeFrom(captured[0].text);
  const wrong = right === "000000" ? "111111" : "000000";

  await assert.rejects(
    () => completeLogin(database, { challengeId, code: wrong, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_wrong" && /4 attempts left/.test(error.message),
  );
  const login = await completeLogin(database, { challengeId, code: right, ip: null, userAgent: null });
  assert.ok(login.token);
});

test("five wrong codes burn the challenge, and the correct code no longer works", async () => {
  const database = await fixture();
  const { challengeId, captured } = await startAndCallback(database);
  const right = codeFrom(captured[0].text);
  const wrong = right === "000000" ? "111111" : "000000";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => completeLogin(database, { challengeId, code: wrong, ip: null, userAgent: null }), (error: unknown) => error instanceof AppError);
  }
  await assert.rejects(
    () => completeLogin(database, { challengeId, code: right, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_exhausted",
  );

  // The failed attempts are still on the record: a rejection is audited even though
  // the transaction that recorded it does not carry a session. Five refusals produce
  // four "wrong" rows and two "exhausted" rows — the fifth wrong attempt burns the
  // challenge, and the correct-but-too-late attempt is refused as exhausted as well.
  const events = await database.transaction((sql) => sql.query<{ kind: string }>("SELECT kind FROM auth_events"));
  assert.equal(events.filter((row) => row.kind === "login_code_wrong").length, 4);
  assert.equal(events.filter((row) => row.kind === "login_code_exhausted").length, 2);
});

test("a code cannot be used twice", async () => {
  const database = await fixture();
  const { challengeId, captured } = await startAndCallback(database);
  const code = codeFrom(captured[0].text);
  await completeLogin(database, { challengeId, code, ip: null, userAgent: null });
  await assert.rejects(
    () => completeLogin(database, { challengeId, code, ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_exhausted",
  );
});

test("a code is not usable after it expires", async () => {
  const database = await fixture();
  const { challengeId, captured } = await startAndCallback(database);
  await database.transaction((sql) => sql.query("UPDATE login_challenges SET expires_at=$1", ["2000-01-01T00:00:00.000Z"]));
  await assert.rejects(
    () => completeLogin(database, { challengeId, code: codeFrom(captured[0].text), ip: null, userAgent: null }),
    (error: unknown) => error instanceof AppError && error.code === "code_expired",
  );
});

test("removing an address from the allowlist refuses a code that was already sent", async () => {
  const database = await fixture();
  const { challengeId, captured } = await startAndCallback(database);
  const code = codeFrom(captured[0].text);
  process.env.RASPBERRY_ALLOWED_EMAILS = "somebody-else@example.com";
  try {
    await assert.rejects(
      () => completeLogin(database, { challengeId, code, ip: null, userAgent: null }),
      (error: unknown) => error instanceof AppError && error.code === "not_allowed",
    );
  } finally {
    process.env.RASPBERRY_ALLOWED_EMAILS = "Owner@Example.com";
  }
});

test("the owner address adopts notes that already exist, and only that address", async () => {
  const database = await fixture();
  await new RaspberryService(database).seed();

  // A different address on the same machine gets a workspace of its own.
  process.env.RASPBERRY_OWNER_EMAIL = "somebody-else@example.com";
  const other = await startAndCallback(database, { fetchImpl: google({ subject: "google-subject-other" }) });
  const otherLogin = await completeLogin(database, { challengeId: other.challengeId, code: codeFrom(other.captured[0].text), ip: null, userAgent: null });
  const otherSession = await verifySession(database, otherLogin.token, { touch: false });
  assert.equal(otherSession.ok, true);
  if (otherSession.ok) assert.notEqual(otherSession.session.workspaceId, "00000000-0000-4000-8000-000000000002", "a non-owner address never adopts the local notes");

  // The named owner lands in the workspace the notes are already in.
  process.env.RASPBERRY_OWNER_EMAIL = ALLOWED;
  try {
    const owner = await startAndCallback(database, { fetchImpl: google({ subject: "google-subject-owner" }) });
    const ownerLogin = await completeLogin(database, { challengeId: owner.challengeId, code: codeFrom(owner.captured[0].text), ip: null, userAgent: null });
    const ownerSession = await verifySession(database, ownerLogin.token, { touch: false });
    assert.equal(ownerSession.ok, true);
    if (ownerSession.ok) assert.equal(ownerSession.session.workspaceId, "00000000-0000-4000-8000-000000000002", "the owner address lands in the existing workspace");
  } finally {
    delete process.env.RASPBERRY_OWNER_EMAIL;
  }
});

test("resending is rate limited rather than free", async () => {
  const database = await fixture();
  const { challengeId } = await startAndCallback(database);
  const captured: Captured[] = [];
  await assert.rejects(
    () => resendCode(database, { challengeId, ip: null, mailer: mailer(captured) }),
    (error: unknown) => error instanceof AppError && error.code === "cooldown",
  );
  assert.equal(captured.length, 0);

  // After the cooldown a second code is issued.
  const later = new Date(Date.now() + 61_000);
  const { captured: fresh } = { captured };
  await resendCode(database, { challengeId, ip: null, now: later, mailer: mailer(fresh) });
  assert.equal(fresh.length, 1);
});
