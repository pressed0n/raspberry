import { test } from "node:test";
import assert from "node:assert/strict";
import { readAuthConfig } from "../src/server/auth/config";
import { loginCodeMessage, smtpTransportOptions } from "../src/server/auth/mail";

/* The relay this was written against is shared hosting: the mailbox lives at
   `mail.<domain>` but the certificate is issued for the provider's own machine name, so
   a handshake that verifies against `smtpHost` fails with
   `Hostname/IP does not match certificate's altnames`. The two tempting fixes are both
   wrong — `rejectUnauthorized: false` encrypts the password to whoever answers, and
   hard-coding the provider's machine name takes the name an operator can look up out of
   the configuration. `smtpServername` is the third option: verify, but against the name
   the certificate actually carries. These tests pin that decision. */

function withEnv(values: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  for (const name of ["RASPBERRY_SMTP_SERVERNAME"]) {
    if (!(name in values)) {
      previous.set(name, process.env[name]);
      delete process.env[name];
    }
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

const BASE = {
  RASPBERRY_PUBLIC_ORIGIN: "https://raspberry.test",
  RASPBERRY_ALLOWED_EMAILS: "owner@example.com",
  RASPBERRY_MAIL_BACKEND: "smtp",
  RASPBERRY_MAIL_FROM: "Raspberry <login@example.com>",
  RASPBERRY_SMTP_HOST: "mail.example.com",
  RASPBERRY_SMTP_PORT: "465",
  RASPBERRY_SMTP_USER: "login@example.com",
  RASPBERRY_SMTP_PASS: "not-a-real-password",
};

test("smtp config is read, including the certificate name", () => {
  const restore = withEnv({ ...BASE, RASPBERRY_SMTP_SERVERNAME: "eh2.provider.example" });
  try {
    const read = readAuthConfig();
    assert.equal(read.ok, true);
    assert.ok(read.ok);
    assert.equal(read.value.mailBackend, "smtp");
    assert.equal(read.value.smtpHost, "mail.example.com");
    assert.equal(read.value.smtpPort, 465);
    assert.equal(read.value.smtpServername, "eh2.provider.example");
  } finally {
    restore();
  }
});

test("without the override the empty string is carried, not a guessed name", () => {
  const restore = withEnv(BASE);
  try {
    const read = readAuthConfig();
    assert.ok(read.ok);
    // Empty, never `smtpHost`: falling back to the host would make the override
    // impossible to tell apart from not setting it.
    assert.equal(read.value.smtpServername, "");
  } finally {
    restore();
  }
});

test("465 is implicit TLS and 587 upgrades in the clear", () => {
  const restore = withEnv(BASE);
  try {
    const read = readAuthConfig();
    assert.ok(read.ok);

    assert.equal(smtpTransportOptions(read.value).secure, true);

    process.env.RASPBERRY_SMTP_PORT = "587";
    const upgraded = readAuthConfig();
    assert.ok(upgraded.ok);
    assert.equal(smtpTransportOptions(upgraded.value).secure, false);
  } finally {
    restore();
  }
});

test("the override becomes tls.servername and is absent when unset", () => {
  const restore = withEnv(BASE);
  try {
    const plain = readAuthConfig();
    assert.ok(plain.ok);
    const withoutOverride = smtpTransportOptions(plain.value);
    // Absent rather than undefined: nodemailer merges `tls` over its own defaults, and a
    // `tls: undefined` is a different value from no `tls` key at all.
    assert.equal("tls" in withoutOverride, false);

    process.env.RASPBERRY_SMTP_SERVERNAME = "eh2.provider.example";
    const overridden = readAuthConfig();
    assert.ok(overridden.ok);
    const options = smtpTransportOptions(overridden.value);
    assert.deepEqual(options.tls, { servername: "eh2.provider.example" });
    // Verification is never turned off: the fix is *what* to verify against, not
    // whether to verify.
    assert.equal("rejectUnauthorized" in options, false);
    assert.equal("rejectUnauthorized" in (options.tls ?? {}), false);
  } finally {
    restore();
  }
});

test("a half-configured relay is still refused, and the override cannot stand in for a password", () => {
  const restore = withEnv({ ...BASE, RASPBERRY_SMTP_SERVERNAME: "eh2.provider.example" });
  try {
    delete process.env.RASPBERRY_SMTP_PASS;
    const read = readAuthConfig();
    assert.equal(read.ok, false);
    assert.ok(!read.ok);
    assert.deepEqual(read.missing, ["RASPBERRY_SMTP_PASS"]);
  } finally {
    restore();
  }
});

test("the email carries the code, the deadline, and names the door that was tried", () => {
  const text = loginCodeMessage("123456", 5);

  assert.match(text, /\b123456\b/);
  assert.match(text, /5 minutes/);
  assert.match(text, /once/);
  // The address is the thing that gets tried now, so it is the thing the warning names.
  assert.match(text, /email address/);
  /* It used to say "someone has your Google password", which was true only while Google was
     the single door. Since an address and a code sign you in on their own, that sentence sent
     people to change a password they may not have and said nothing about the actual attack.
     Google is now optional and off on the hosted copy, so this must not come back. */
  assert.doesNotMatch(text, /google/i);
  assert.doesNotMatch(text, /password/i);
});
