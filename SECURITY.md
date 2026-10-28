# Security status

Raspberry is a working notes application with two access modes. Local mode is suitable
for one machine. Hosted mode is implemented but has not survived a real exposure yet —
treat the first weeks on a public address as a trial, not a settled deployment.

## Access modes

Selected by `RASPBERRY_AUTH_MODE`.

- **`local`** — loopback only. The Host header must match a loopback allow-listed value,
  and mutating browser requests must carry an allow-listed `Origin`. Selected by
  `pnpm dev` and `pnpm preview`, which set `RASPBERRY_LOCAL_DEV=1`.

- **`session`** — hosted. Google sign-in proves identity, a 6-digit code emailed to the
  same address proves the inbox, and the resulting session cookie admits the request.
  Transport rules: bare `https` public origin, Host allow-list, Origin allow-list, no
  cross-site mutations, and plaintext forwards rejected.

`pnpm start` validates the whole set at boot and exits with a named list of what is
missing. A hosted deployment that cannot authenticate anyone does not start.

## What the two factors are, honestly

Google is the first factor; the emailed code is the second. If the allow-listed address
*is* the Gmail account, then one compromise of that account defeats both — it is
"Google plus Google". Pointing `RASPBERRY_ALLOWED_EMAILS` at a different mailbox provider
makes them genuinely independent channels.

The allowlist is mandatory and re-checked when the code is submitted, so removing an
address takes effect on an in-flight login rather than at the next session.

## Sessions

- The cookie holds `<sessionId>.<secret>`. Only SHA-256 of the secret is stored, so a
  copy of the database cannot be replayed as a login.
- Two clocks: a 12-hour idle window that slides on use, and a 30-day absolute deadline
  that never moves.
- The role is read from `memberships` on every request, so a downgrade is immediate. A
  session whose membership has gone is refused rather than defaulted.
- Sign-out revokes the row. Clearing the cookie alone would leave a copied cookie working.
- Cookie name is `__Host-` prefixed, so it cannot be set or overwritten by a subdomain.

## Login codes

Six digits from `crypto.randomInt`, stored as salted scrypt, compared with
`timingSafeEqual`. Five-minute lifetime, five attempts, single use, 60-second resend
cooldown, five sends maximum. The attempt counter lives in the database, so a restart
does not reset it. A new code invalidates the previous one.

## What is recorded

`auth_events` keeps sign-in outcomes with **hashed** email and IP — never the raw
values, and never a code or token. Rejections are recorded even though the request
transaction does not carry a session; that ordering is deliberate and tested.

## What is not defended yet

- **No server-side session revocation UI.** Revocation exists as a function and on
  logout, but there is no "sign out all devices" control.
- **Rate limiting is per-process and in memory.** It is a speed bump. The real bound on
  code guessing is the per-challenge attempt counter.
- **No WebAuthn.** A hardware key would be a strictly better second factor than email.
- **No CSP nonces.** The policy is a static allow-list; the login page deliberately uses
  a plain link to Google rather than Google's script, so `script-src` stays first-party.
- **MCP over HTTP is not authenticated.** The stdio server still uses the local actor.
  A hosted MCP endpoint needs its own token store, and does not exist yet.

## Deployment floor, outside this repository

TLS termination (Caddy or nginx), `RASPBERRY_TRUST_PROXY=1`, key-only SSH with no root
login, a host firewall allowing only 80/443, unattended security updates, and backups
kept **off** the machine. An AGPL source repository plus an unpatched host is a
published exploit, not a distribution.

## Reporting

No private reporting channel is published yet. Do not commit credentials, `.env.local`,
`data/`, or backup files — CI fails the build if any of those are ever tracked.
