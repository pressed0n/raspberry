# Security status

Raspberry v0.1 is a local development prototype. It is not ready to host private data over the internet.

## Current boundaries

- Web launchers bind to `127.0.0.1`.
- The application requires explicit local-development mode and checks the Host and Origin headers. Mutating browser requests require an allowed Origin. Forwarded host headers are not trusted.
- API handlers repeat access checks independently of the Next.js proxy.
- Shared service operations enforce workspace membership, including read-only viewer restrictions.
- Structured input validation, bounded request bodies, revision preconditions, transactionally stored history, and durable mutation receipts protect document operations.
- MCP defaults to read-only. Enabling local MCP writes trusts that process as the local development owner.
- The browser stores unsaved draft copies on the device. Treat browser profiles and backups as private data.

These controls do not replace authentication. Any trusted local process can impersonate an HTTP client, and a tunnel or proxy could defeat assumptions about the network path. Never publish this prototype by forwarding it and rewriting Host headers.

## Before remote access

Complete Google-plus-email-code enforcement, session lifecycle/recovery, account invitations, OAuth grants for MCP, per-client/page authorization, audit/retention policies, dependency review, and encrypted off-device recovery. Verify the host's firewall and actual IPv4/IPv6/container port exposure. Test two real users and revoke sessions/grants during tests.

The local CSP permits inline framework scripts/styles and development-only eval. The production security review must tighten it where supported, preferably with per-request nonces. A successful dependency audit only describes known advisories at that point in time; it is not a security guarantee.

## Reporting

There is not yet a public repository or security contact. Before publishing, configure a private reporting channel and document supported releases. Do not commit credentials, `.env.local`, the `data/` directory, or backup files to source control.
