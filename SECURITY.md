# Security status

Raspberry v0.1 is a local development prototype. It is not ready to host private data over the internet.

## Access modes

The access guard has exactly two modes, selected by `RASPBERRY_AUTH_MODE`.

- **`local`** (default, and the only mode that can serve data today). Loopback only. The Host header must match a loopback allow-listed value, and mutating browser requests must carry an allow-listed `Origin`. A tunnel or reverse proxy will fail this check by design; do not rewrite Host headers to get around it.
- **`session`** (the hosted path: public domain, TLS, Google sign-in plus an email code). The transport checks are implemented and tested: the public origin must be a bare `https` origin, the Host header must be allow-listed, mutations must carry an allow-listed `Origin` and must not be `sec-fetch-site: cross-site`, and a request a trusted proxy marked as plaintext is refused. **Every request is then refused with `auth_not_configured`**, because no session store exists yet.

That second mode is a reviewed seam, not a feature. Opening Raspberry to the internet requires replacing one return value in `src/server/access.ts` and implementing `resolveActor` in `src/server/session.ts`. `pnpm start` refuses to boot in session mode for the same reason.

## Current boundaries

- Web launchers bind to `127.0.0.1`.
- API handlers repeat access checks independently of the Next.js proxy, so a proxy bypass alone does not grant access.
- Callers are resolved once, in `api()`, and passed to every handler as an `Actor`. No route imports a module-level identity any more.
- Shared service operations enforce workspace membership, including read-only viewer restrictions.
- Structured input validation, bounded request bodies, revision preconditions, transactionally stored history, and durable mutation receipts protect document operations.
- In-process rate limiting bounds reads and writes. It also caps a runaway client save loop, and it is per-process, so it is not a substitute for a proxy-level limiter.
- Every API response carries an `X-Request-Id` that is also written to the server log with failures.
- MCP defaults to read-only. Enabling local MCP writes trusts that process as the local development owner.
- The browser stores unsaved draft copies on the device. Treat browser profiles and backups as private data.

These controls do not replace authentication. Any trusted local process can impersonate an HTTP client.

## Before remote access

Complete Google-plus-email-code enforcement, session lifecycle/recovery, account invitations, OAuth grants for MCP, per-client/page authorization, audit/retention policies, dependency review, and encrypted off-device recovery. Verify the host's firewall and actual IPv4/IPv6/container port exposure. Test two real users and revoke sessions/grants during tests.

Known gaps that are deferred rather than fixed:

- Idempotency receipts and rate limits still share one client namespace (`"browser"`) for all browser traffic. Both must key on the session once sessions exist.
- There is no audit trail recording which client wrote which page. `mutations` has no timestamp column, so receipts cannot be expired retroactively either.
- No `Content-Security-Policy` nonces yet. The policy permits inline framework scripts/styles, and development-only eval; WebSockets are allowed only in development builds, and HSTS is emitted only for a hosted build.
- No per-page or per-database permissions. `access()` is workspace-scoped.

## Reporting

The repository is initialised locally; no public remote has been published yet. Before publishing, configure a private reporting channel and document supported releases. Do not commit credentials, `.env.local`, the `data/` directory, or backup files to source control.
