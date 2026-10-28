# Raspberry

A quiet home for your notes and ideas. An independent workspace built for people and AI.

**Status: local foundation prototype, v0.1.** Page editing, persistence, and local MCP work. Google login followed by an email code, remote MCP authorization, internet hosting, databases/views, and real-time collaboration are upcoming work. This prototype deliberately rejects non-loopback hosts and does not provide production authentication.

## Run locally

Requirements: Node.js 24+ and pnpm 11.25.0. No GPU, Docker, PostgreSQL installation, or AI API key is required for the default preview.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:3000>. The launcher binds to loopback and explicitly enables local development. Your pages live in `data/raspberry.sqlite`, with WAL sidecar files. That directory is ignored by Git. Keep it when upgrading or restarting. The first run creates three welcome pages.

On Windows, after dependencies are installed, you can also double-click `Start-Raspberry.cmd`. It uses Node from your PATH or the bundled Codex Node runtime when available. Keep its window open while using the app; closing it stops the server. If it reports that the port is already in use, a Raspberry process may already be running—try the browser address first.

`127.0.0.1` always refers to the device opening the browser. Opening this address on NikDTM will not connect to the main PC. Raspberry must be installed and running on NikDTM before that laptop can serve it; access from other devices will need the authenticated hosting setup described in the plan.

For optional configuration, copy `.env.example` to `.env.local`. The local launcher reads that file. `PORT` can select another port.

For a production-build **local preview**:

```powershell
pnpm build
pnpm preview
```

`pnpm start` does not automatically enable local mode. Requests fail closed without explicit local-mode configuration. Neither launch path is an authenticated internet deployment. Do not expose the prototype through a tunnel, reverse proxy, or router port forwarding.

## Access modes

Raspberry has two access modes, selected by `RASPBERRY_AUTH_MODE`.

| Mode | Status | What it enforces |
| --- | --- | --- |
| `local` (default) | Works | Loopback Host only; mutations need an allow-listed `Origin`. A tunnel or proxy fails by design. |
| `session` | **Refused** | The hosted path: bare `https` public origin, Host allow-list, allow-listed `Origin`, no cross-site mutations, HTTPS-only when behind a trusted proxy. Every request is then rejected with `auth_not_configured`. |

Session mode is a reviewed seam, not a feature: the transport checks are implemented and covered by tests, and the only remaining work is a session lookup plus one return value in `src/server/access.ts`. `pnpm start` refuses to boot while `RASPBERRY_AUTH_MODE=session`, so Raspberry cannot be half-exposed by accident. `pnpm start` binds `RASPBERRY_HOST` (default `127.0.0.1`), which is what a future reverse proxy will sit in front of.

Raspberry also rate limits reads and writes per process, returns an `X-Request-Id` with every API response, and exposes `GET /api/health` for service supervision. That path is exempt from the access guard and reports liveness only.

To survive a reboot on the machine that hosts it, `scripts/install-service.ps1` registers a Windows Scheduled Task at sign-in with automatic restart, and `deploy/raspberry.service` is the equivalent systemd unit for the future Linux VPS. Both are opt-in and unverified until you run them.

## What works

- Pages and nested subpages, editable titles, page icons, and favorites.
- Rich text, headings, lists, checkboxes, quotes, code blocks, tables, dividers, slash commands, and formatting controls.
- Colored callouts with changeable emoji and nested blocks; two-to-five editable columns that stack on phones.
- Inline child-page blocks and searchable links to existing pages; typing `:` immediately opens searchable emoji choices.
- Debounced autosave with explicit status, local draft recovery, retry protection, and conflict detection.
- Search across page titles and text; desktop and phone-size layouts.
- Trash/restore for page subtrees; independently trashed children remain in trash.
- Version history and restoration as a new revision; Markdown export and page duplication.
- Shared document operations used by the web API and MCP tools.
- A local stdio MCP server, read-only by default.
- A consistent SQLite backup command and tested restoration of a backup into a separate database.

The interface is responsive, but access from another physical device is intentionally not enabled yet. Pages are stored on the server; browser local storage is only used for unsaved draft recovery.

### Slash commands

| Type | Result |
| --- | --- |
| `/callout` | Colored container with an emoji; type and insert other blocks inside it. Click the emoji or use the color selector to customize it. |
| `/page` | Creates an empty child page and inserts its clickable page block at the cursor. |
| `/link to page` | Searches existing pages and inserts a link without changing the target's parent. |
| `/table` | Editable table, with the editor's row and column controls. |
| `/divider` | Horizontal separator. |
| `/2 columns` through `/5 columns` | Independent block containers; use “Write below columns” to continue beneath the layout. |
| `:` or `:smile` | Emoji choices immediately, optionally filtered by name; arrows and Enter select an emoji. |

Existing child pages receive links in their parent during the version-2 data migration. New child pages created from the sidebar or API also add a link automatically. Removing a page-link block removes the reference; moving a page to trash still uses the page actions menu. Renamed targets update their displayed link titles when loaded.

Callouts and columns use Raspberry's custom core-editor layouts; no paid editor extension was added. Markdown exports keep nested content and tables, flatten columns into labeled sections, and represent callouts as blockquotes.

## Local MCP

The client must support stdio MCP servers and run on a machine that can access this project/database. A cloud-hosted connector cannot use this stdio entry point directly.

Example MCP client configuration, replacing paths with your own Node executable and checkout:

```json
{
  "mcpServers": {
    "raspberry": {
      "command": "C:/path/to/node.exe",
      "args": ["--import", "tsx", "src/mcp/stdio.ts"],
      "cwd": "C:/Users/Preston/Documents/ai/Raspberry",
      "env": {
        "RASPBERRY_LOCAL_DEV": "1",
        "DATABASE_URL": "file:C:/Users/Preston/Documents/ai/Raspberry/data/raspberry.sqlite",
        "RASPBERRY_MCP_WRITE": "0"
      }
    }
  }
}
```

Available by default: `search_pages`, `get_page`, and `list_children`. Explicitly set `RASPBERRY_MCP_WRITE=1` to also enable `create_page`, `append_blocks`, and `update_blocks` for a trusted local client.

Write requests require UUID mutation IDs. Block edits also require the current revision and stable block IDs. Retry an identical operation with its original mutation ID; use a new one for a new change. Conflicting revisions fail rather than overwriting another editor's work. The local client is trusted as the development workspace owner; scoped OAuth grants will replace this identity model before remote access.

The MCP handshake and tools are tested with the official SDK, including a real stdio subprocess. Connections to the actual DeepSeek, ChatGPT, Claude, and Gemini interfaces have **not** been configured or verified. Remote Streamable HTTP plus OAuth is the next integration milestone. DeepSeek needs a selected MCP-aware host or bridge; Gemini CLI is the currently researched Gemini path.

## Back up and recover

```powershell
pnpm backup
```

This creates a uniquely named snapshot under `data/backups/` using SQLite's backup API and verifies its integrity. It includes committed WAL data and does not overwrite an existing backup. This is a local recovery aid; it is not encrypted or off-device disaster recovery. Keep backups private.

To recover, first stop both the web app and any MCP processes. Preserve the entire existing `data/` directory under a different name, create a fresh `data/` directory, and copy the selected snapshot into it as `raspberry.sqlite`. Start the app and verify the pages. Do not combine a restored database file with old `-wal` or `-shm` sidecars. Retain the old directory until verification is complete.

Automatic encrypted off-device backups, retention, and recovery drills on NikDTM are required before real hosting.

## Storage and architecture

```text
Browser API ----+
                +--> RaspberryService --> membership checks --> database transaction
Local MCP ------+                         + revision check       + pages
                                          + mutation receipt     + history
```

The authoritative document is schema-versioned BlockNote JSON with UUID block IDs. This release uses optimistic revisions, not live collaborative merging. Yjs remains a separate design decision requiring a migration and simultaneous browser/MCP editing tests before adoption. There are no competing canonical JSON and CRDT copies.

Users, workspaces, owner/editor/viewer memberships, revisions, and retry receipts already exist in the schema. Only the seeded local owner is reachable through the current adapters. These tables do not amount to a complete user authentication or invitation system.

SQLite is the default for the Windows prototype. A PostgreSQL adapter uses the same service/schema and is selectable with `DATABASE_URL=postgres://...`. It is not exercised against a live PostgreSQL server in this environment. Its pilot transaction lock prioritizes consistency over parallel throughput. Merely changing the URL does not migrate existing data; migration tooling is upcoming. Schema v1 is initialized idempotently; future schema changes require versioned migrations.

Prototype limits: 1 MB HTTP write bodies, 2,000 blocks, ten nested block levels, 200 pages per browser listing, 30 revisions shown in history, and basic case-insensitive substring search. Storage/receipt retention and full-text indexing need work before larger datasets. The JSON document validator only accepts the block types enabled in the editor; attachments and embeds are intentionally absent.

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod --audit-level=high
```

Tests cover stale/concurrent edits, exact retries, cross-workspace access, viewer restrictions, subtree recovery, disk persistence, input validation, local-access guards, live backup recovery, MCP tools, and the stdio entry point. The first prototype was also manually checked in a browser for editing, autosave, reload persistence, search, and a 390-pixel phone viewport.

## Next milestones

1. Implement and test Google OpenID Connect followed by an email code, including a pending-login state that cannot read pages or issue MCP credentials.
2. Add invitation/account management, session revocation, and stronger account protection/recovery.
3. Exercise PostgreSQL, create migration tooling, and prepare a reproducible deployment for NikDTM on Windows.
4. Add remote MCP with OAuth, explicit grants, audit records, and checks in all four target AI interfaces.
5. Configure a stable domain, private administration, HTTPS ingress, encrypted off-device backups, and reboot recovery before public reachability.
6. Add typed databases and saved table/board/calendar views.

See [the research plan](RASPBERRY_PLAN.md) and [security notes](SECURITY.md).

## License

Raspberry is released under the [MIT License](LICENSE). Third-party code retains its own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
