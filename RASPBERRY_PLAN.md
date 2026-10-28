# Raspberry: research and implementation plan

Research date: 25 October 2026. Status: implementation started. A local page-editor foundation prototype now exists; see README.md for verified capabilities and limitations. It has not been deployed to NikDTM or the internet.

## 1. Recommended direction

Build Raspberry as an independent open-source web app using established editor, authentication, database, and MCP libraries. Start with a dependable page editor; then add structured databases and saved views. Keep hosting portable with Docker Compose so the same application can move from NikDTM to a cloud VPS.

Use a small application with shared business logic rather than separate services for every feature. Browser actions, ordinary API calls, and MCP tools must use the same authorization and document operations. This is especially important because AI access is a primary workflow.

Treat “almost all Notion features” as a long-term direction. Turn it into a tracked feature matrix before making parity claims. Reliable editing, databases, collaboration, and import/export are separate substantial projects.

### Confirmed requirements

| Topic | Current requirement |
| --- | --- |
| Product | Raspberry, open source, inspired by Notion |
| First release | Personal use across desktop and mobile; a simple page editor is sufficient initially |
| Next priorities | Databases and multiple database views; testing with additional users soon |
| Initial host | NikDTM laptop, kept powered on; reported 16 GB RAM, approximately 6–7 GB VRAM, and 80 GB storage |
| Later host | A cloud VPS, with a documented migration process |
| Sign-in | Google login **followed by** an email one-time code |
| AI | DeepSeek is the main future target; ChatGPT, Claude, and Gemini are also required |
| Security | Strong protection of the app, host, accounts, and stored data |

The user confirmed NikDTM runs Windows and has 80 GB free. The processor, internet upload speed, other workloads, and remote administration access remain unverified. I have not inspected or connected to NikDTM.

Implementation update: the prototype uses schema-versioned BlockNote JSON, SQLite for easy local startup, and an optional PostgreSQL adapter. Browser and stdio MCP operations share the same service and permission checks. Production authentication, remote MCP OAuth, live PostgreSQL validation, hosting, and cross-device access remain upcoming. The roadmap below remains the long-term proposal, not a list of completed features.

## 2. Build versus fork

Reusing a complete application can save considerable implementation work, but creates an upstream maintenance and licensing dependency. Reusing an editor gives us a faster starting point while retaining control over Raspberry's data model and MCP behavior.

| Foundation | Findings | Recommendation |
| --- | --- | --- |
| Independent app + BlockNote | Notion-style block editor built on ProseMirror/Yjs. Core is MPL-2.0; XL packages use GPL-3.0 or a commercial license. | Preferred starting point for a short editor prototype. Audit the exact packages selected. |
| Independent app + Tiptap | MIT-licensed editor core with extensive customization; some advanced features and templates are paid. | Strong alternative if BlockNote constrains the editor or licensing goals. More UI work. |
| AFFiNE | Existing self-hosted workspace with documents, databases, and collaboration. Current repository licensing has MIT, MPL, and enterprise distinctions. | Useful benchmark and possible fork candidate only after a release-specific audit of required code and features. |
| AppFlowy | Client repository remains AGPLv3. Archived AppFlowy-Cloud documentation says the current server core is commercial and new server features are distributed in official images. | Do not assume its current full stack is an entirely open-source foundation for Raspberry. |
| Outline | Team knowledge base with BSL-1.1 licensing. | Poor fit for an independent, unrestricted open-source Notion alternative. |

Sources: [BlockNote licensing](https://www.blocknotejs.org/pricing), [Tiptap editor documentation](https://tiptap.dev/docs/editor/getting-started/overview), [AFFiNE root license](https://github.com/toeverything/AFFiNE/blob/canary/LICENSE), [AFFiNE server license](https://github.com/toeverything/AFFiNE/blob/canary/packages/backend/server/LICENSE), [AppFlowy client](https://github.com/AppFlowy-IO/AppFlowy), [AppFlowy server status](https://github.com/AppFlowy-IO/AppFlowy-Cloud), and [Outline repository](https://github.com/outline/outline).

**Decision:** provisionally favor the independent app. Before committing, time-box a prototype that tests mobile editing, document persistence, programmatic block edits, concurrent saves, and package licenses. Choose the editor from evidence. A complete-app fork should win only if it materially reduces work while meeting our authentication, MCP, portability, and licensing requirements.

Choose Raspberry's license before publication. Apache-2.0 and AGPL-3.0 are candidates with different sharing goals; the final choice must fit all included dependencies. Preserve third-party notices and use original Raspberry branding and assets.

## 3. Proposed technical foundation

| Area | Starting choice | Reason |
| --- | --- | --- |
| Web app | TypeScript, React, Next.js, responsive styling | One language across UI and server; conventional self-hosting |
| Editor | BlockNote core, subject to prototype | Existing block interactions and structured document format |
| Database | PostgreSQL with migrations | Pages, accounts, permissions, structured records, and search |
| Data access | Drizzle, provisionally | Typed queries and explicit migrations |
| Authentication | Better Auth, subject to sign-in and MCP proof | Google sign-in, OTP components, sessions, OAuth provider capabilities |
| Search | PostgreSQL full-text search | Avoid a second search service during the pilot |
| Attachments | Private persistent file storage behind an application storage interface | Simple initially; can later use an S3-compatible backend |
| MCP | Official TypeScript SDK, Streamable HTTP | A provider-neutral interface for external AI clients |
| Deployment | Docker Compose; production app, database, reverse proxy, tunnel as needed | Reproducible deployment on laptop and VPS |
| Backup | PostgreSQL dumps + attachment snapshots + encrypted off-device backup | Recoverability independent of the laptop |

These are proposed choices, not installed dependencies or verified integrations. Pin supported stable versions during implementation and record why they were chosen.

[Next.js recommends a reverse proxy for self-hosting](https://nextjs.org/docs/app/guides/self-hosting). [PostgreSQL supports indexed full-text search](https://www.postgresql.org/docs/current/textsearch-intro.html). Better Auth documents [Google sign-in](https://better-auth.com/docs/authentication/google), [email OTP](https://better-auth.com/docs/plugins/email-otp), and an [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider); those pieces still require integration and testing together.

Avoid adding Redis, Kubernetes, a vector database, or a local AI model until a measured requirement justifies them. External AI access through MCP does not require an LLM to run on NikDTM. Its VRAM is therefore irrelevant to the initial app. Local DeepSeek hosting would be a separate sizing and model-quality decision.

### Data model decisions to make early

- Users, workspaces, memberships, and roles from the beginning, even with one user.
- Pages with parent relationships, titles, stable IDs, archive/trash state, and revision history.
- Stable block IDs and schema versions; AI edits target blocks rather than replacing arbitrary HTML.
- One authoritative document representation. Test Yjs persistence and server-side edits in the prototype. If we begin with versioned editor JSON instead, explicitly plan the later collaboration migration before storing important data.
- Revision checks and idempotency for writes so a browser and AI cannot silently overwrite each other.
- Attachments stored outside the public web directory and authorized on every retrieval.
- Databases represented as collections with typed properties and records. Each record can own page content. A view stores filters, sorting, visible properties, and layout over those same records.

Database views must share records: changing a task on a board should change the same task in its table and calendar. Relations, rollups, and formulas can be added later without treating each view as a separate database. Formula execution will need a restricted expression engine, not arbitrary JavaScript execution.

## 4. Hosting on NikDTM

The reported 16 GB RAM should be adequate for a small pilot with the proposed stack, subject to other laptop workloads and measurement. If 80 GB is free, it is a plausible starting amount for a text-first app with modest uploads. Reserve room for the OS, images, database growth, logs, upgrades, and temporary backups. Set disk alerts and upload quotas before inviting testers.

Prefer a dedicated, supported Linux installation if the laptop can be devoted to hosting. If it must remain a Windows workstation, evaluate a dedicated Linux VM first; WSL2/Docker Desktop are alternatives, but unattended startup and recovery after Windows reboots must be demonstrated. Do not decide or change the OS without knowing its current use and preserving needed files.

The laptop is a temporary self-hosted server, rather than a cloud VPS. Availability depends on home internet, power, cooling, sleep settings, and restarts. Configure automatic service startup, recovery after reboot, and no sleep while hosting. Confirm sustained temperatures, stable networking, and available upload bandwidth.

### Access strategy

| Option | What it gives us | Limitation |
| --- | --- | --- |
| Tailscale private access | App and administration reachable only by enrolled devices | Requires client installation; cloud AI connectors normally cannot join that private network |
| Cloudflare Tunnel | Stable HTTPS access from ordinary browsers and hosted AI services, without opening router inbound ports | The exposed application still needs full authentication and authorization; introduces a proxy dependency |
| Direct router port forwarding | Direct public hosting | Adds exposure and NAT/firewall work; unnecessary for this pilot |

Begin private while validating the app. For the requested cross-provider AI connections, plan a named Cloudflare Tunnel with a domain you control, or an equivalent HTTPS ingress. Keep administration private over Tailscale. Cloudflare documents its [outbound tunnel connection](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/); Tailscale documents [tailnet-only Serve access](https://tailscale.com/docs/features/tailscale-serve).

Proposed public layout, using placeholder hostnames:

```text
Desktop/mobile browser -> HTTPS ingress -> reverse proxy -> Raspberry UI/auth/API
AI host               -> HTTPS ingress -> /mcp         -> shared application logic
                                                         -> PostgreSQL
                                                         -> private attachments
Administrator         -> private VPN -> host administration
```

Expose only the required application, MCP, authentication, and OAuth discovery routes. Keep PostgreSQL and administration unreachable from the public internet. A separate MCP hostname is an option if it makes route policies clearer.

Do not put a browser-only Cloudflare Access challenge in front of MCP or its required metadata/token routes unless the selected AI client explicitly supports it. Raspberry's OAuth flow must protect these endpoints. Never solve that compatibility problem by making document tools anonymous.

Cloudflare terminates proxied HTTPS, so the design does not provide end-to-end encryption against the proxy provider. Likewise, AI providers receive whatever content we authorize their clients to retrieve. Server-side search and AI access require an explicit privacy model; end-to-end encrypted documents would require a different design.

## 5. Google login followed by an email code

Implement the sequence you requested:

1. Complete Google OpenID Connect sign-in.
2. Verify the identity server-side and enforce the initial account allowlist.
3. Establish a short-lived pending-login state with no document/API/MCP access.
4. Send a one-time code to that verified account's approved email address.
5. Verify the code server-side, then issue a fully authorized session.

Bind the code to the account and pending login. Use short expiry, single use, attempt and resend limits, safe secret storage, and generic failure responses. Exclude codes and tokens from logs. Rate-limit by account and network with trusted proxy configuration. Use secure, HttpOnly cookies, session rotation, session revocation, and an explicit recovery process.

Use Google's stable subject identifier to identify the account, rather than email as its permanent key. Request only identity scopes; Gmail and Drive access are unnecessary for sign-in. See [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

**Critical implementation detail:** Better Auth's 2FA plugin does not automatically challenge OAuth/social logins. Adding Google and OTP plugins is insufficient. We must implement and test server-side enforcement, including direct API calls, session endpoints, and OAuth token issuance. Its [2FA documentation states this limitation](https://better-auth.com/docs/plugins/2fa).

Google login plus a code delivered to the same Gmail account is an extra verification step, but not an independent phishing-resistant factor. Preserve your requested flow and recommend a passkey/security key or authenticator factor for stronger protection, especially for administration. Recovery must not silently bypass that factor. See [OWASP's discussion of independent factors and email limitations](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

Use a transactional email service or authenticated SMTP relay, not a home-hosted mail server. A sender domain and its verification/DNS configuration may be needed. Account setup, sender verification, delivery testing, and spam-folder checks are deployment dependencies. Provider example: [Resend domain setup](https://github.com/resend/resend-skills/blob/main/skills/resend/references/domains.md).

## 6. MCP and the four AI targets

Build an **MCP server** that external AI hosts can call. Raspberry does not need an embedded chatbot to provide this capability. An MCP-aware client executes tool requests; the model alone does not establish the connection.

| Target | Initial integration path | What must be proven |
| --- | --- | --- |
| DeepSeek, primary | MCP-aware agent app using the DeepSeek API; alternatively a small bridge that maps discovered MCP tools to DeepSeek function calls | Select the actual host; test discovery, tool execution, consent, and multi-turn edits. Do not assume the ordinary DeepSeek website supports arbitrary MCP servers. |
| ChatGPT | Custom remote MCP connection packaged through its supported plugin flow | Account/workspace access, OAuth, and read/write tools in the user's actual surface |
| Claude | Custom remote MCP connector | OAuth, public reachability, and requested tool permissions |
| Gemini | Gemini CLI is a documented MCP-capable route; another Gemini host can be evaluated if preferred | Confirm whether the intended interface is CLI, an API agent, or the consumer Gemini app |

Primary sources: [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/), [ChatGPT custom MCP server documentation](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), and [Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/).

Claude states that remote connectors originate from its cloud infrastructure, including when used in its desktop app. An app reachable only through your personal VPN will therefore not satisfy that route. OpenAI also documents a [Secure MCP Tunnel option](https://developers.openai.com/api/docs/guides/tools-connectors-mcp); that could help its own products, but does not establish a common route for all four providers. Prefer one provider-neutral HTTPS endpoint for the cross-provider pilot.

### Initial tools

Start with `search_pages`, `get_page`, and `list_children`. Then add `create_page`, `append_blocks`, and `update_blocks`, using revision preconditions and stable block identifiers. Introduce reversible archive/restore before permanent deletion. Add database schema, query, and record tools alongside the database feature.

Make the contract small and precise: pagination, bounded response sizes, structured errors, schema versions, and useful descriptions. Search/fetch aliases can be added where a client's retrieval workflow needs them. Publish example configurations once tested.

### Authorization and write controls

Use Streamable HTTP and a tested SDK, with protocol compatibility checked against each target client. Remote authorization should use OAuth with PKCE, discovery metadata, resource-bound tokens, explicit consent, expiration, and revocation. Support the client registration mechanisms required by the chosen hosts; do not hand-build the protocol. See the [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) and [transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports).

An AI grant must be the intersection of the user's current permissions, selected workspace/pages, and tool scopes. Default to read-only; enable writes deliberately. Check grant revocation and workspace membership on requests. Do not pass Google login tokens through as Raspberry MCP credentials.

Audit the user, client, operation, affected IDs, revision, time, and outcome without recording secrets or unnecessary document content. Put high-impact actions behind server-enforced previews/approval tokens when introduced; client-side confirmation is not an authorization boundary. Treat retrieved page content as untrusted data and give the MCP server no shell or unrestricted filesystem tool. Address origin validation, token misuse, prompt injection, and SSRF using [MCP security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices).

## 7. Security and recovery standard

No system can guarantee that nobody will ever hack it. The practical requirement is to reduce exposure, enforce access boundaries, detect problems, patch promptly, and recover reliably. Use relevant [OWASP ASVS 5.0](https://asvs.owasp.org/) controls as an acceptance checklist, aiming toward Level 2 coverage for applicable controls rather than claiming certification.

| Boundary | Required pilot controls |
| --- | --- |
| Host | Supported OS, security updates, private administration, strong administrator authentication, minimal installed services, no daily administrator use |
| Network | No router port forwarding for this design; explicit tunnel routes; database private; verify IPv4 and IPv6 exposure |
| Containers | Non-root application process, limited privileges/mounts, resource limits, no Docker socket in the app, rootless runtime where practical |
| Application | Centralized permission checks, input validation, parameterized database queries, XSS sanitization, CSP, CSRF protection, safe URL/embed handling |
| Files | Size/type limits, authorized downloads, safe content disposition, no executable uploads, path traversal prevention |
| Accounts | Google-plus-code enforced on the server, no public signup initially, invitation rules for testers, recovery and session/token revocation |
| Delivery | Locked dependencies, vulnerability/secret scanning, reviewed releases, protected deployment credentials, documented update and rollback process |
| Operations | Health checks, disk/backup alerts, bounded logs, audit trail, response procedure for a stolen account or compromised host |

Docker-published ports can bypass ordinary UFW expectations. Validate the actual bindings and external reachability rather than relying on a firewall screenshot. See [Docker firewall documentation](https://docs.docker.com/engine/network/packet-filtering-firewalls/) and [rootless mode](https://docs.docker.com/engine/security/rootless/).

Even during the personal pilot, test with two synthetic users/workspaces. Verify that guessed IDs, search results, attachments, exports, revisions, and MCP tools cannot cross permission boundaries. Before inviting real testers, complete those tests and a restore drill. Shared workspaces can begin with owner/editor/viewer roles; granular page sharing comes later.

Back up the database, attachments, and the configuration/secrets needed to recover. Store encrypted backups off NikDTM; a second folder on the same drive is insufficient. Keep backup keys separately recoverable, and prefer a destination where a compromised app cannot erase all history.

Use a consistent database dump and coordinate it with attachment snapshots; copying a live PostgreSQL data directory is not the plan. PostgreSQL documents [dump consistency and restoration](https://www.postgresql.org/docs/current/backup-dump.html). Restic provides [repository checks](https://restic.readthedocs.io/en/stable/045_working_with_repos.html).

Proposed initial recovery targets: at most 24 hours of data loss and restoration within 4 hours once replacement hardware is available. These are targets to agree and test, not established guarantees. Start with nightly backups, 7 daily and 4 weekly recovery points, and periodic restoration into a clean environment; adjust for data volume and acceptable loss.

## 8. Delivery roadmap

Effort ranges below are rough engineering estimates for focused work, including basic tests and documentation. They are not elapsed-time promises. Answers, integration failures, import complexity, and security review can change them.

| Phase | Scope | Exit condition | Rough effort |
| --- | --- | --- | --- |
| 0 — Prove foundations | Laptop inventory, editor/storage/MCP prototype, dependency/license review, threat model, architecture decisions | A saved document can be read and safely edited through both browser and tool calls; deployment choice recorded | 2–4 days |
| 1 — Personal page editor | Page tree, create/rename/edit/delete-to-trash, basic blocks, autosave status, revisions, search, responsive UI, Google-plus-code, Compose | Sign in from PC/mobile, create/edit/reopen content, detect conflicting edits, restore a deleted page and a backup | 1–3 weeks |
| 2 — AI access and laptop pilot | Read then write MCP tools, grants/auditing, DeepSeek host integration, ChatGPT/Claude/Gemini checks, stable HTTPS, email delivery, off-device backups | Four concrete client paths tested; unauthorized calls fail; app returns after reboot; restore drill passes | 1–2 weeks |
| 3 — Databases and views | Typed properties and records; table then board; filters/sorts and saved views; calendar after dates | The same record works across views and through MCP; schema changes preserve data | 2–4 weeks |
| 4 — Shared testing | Invitations, workspace roles, concurrency/collaboration, comments, stronger access tests, abuse limits | Two real users can work safely with tested isolation, revocation, and recovery | 2–4 weeks |
| 5 — Broader feature coverage | Relations/rollups/formulas, templates, backlinks, richer imports/exports, advanced sharing, offline work, automation | Workflow-based acceptance tests and an updated parity matrix | Ongoing, likely many months |

Prepare Phase 4's permission foundations in Phase 1, and allow an earlier small tester trial once its isolation/security gates pass. Database work and MCP database tools should evolve together. Near-complete Notion parity is not part of the first release estimate.

A first editor should include paragraphs, headings, lists, checkboxes, links, and basic code blocks. Images/attachments can follow once storage controls work. Begin with reliable online editing; an installable PWA and offline editing are separate milestones. Markdown/JSON export should arrive early for portability; a Notion importer needs sample exports and documented limitations.

## 9. Migration to a cloud VPS

Keep application configuration external, database migrations versioned, and persistent data outside disposable containers. Maintain a stable domain and storage abstraction. Do not bake laptop paths, local addresses, or development secrets into documents or client code.

When ready:

1. Provision and harden the VPS; deploy the same tested application version.
2. Restore a rehearsal backup and validate permissions, document counts, attachment checksums, login, and MCP access.
3. Schedule cutover; stop writes on NikDTM and make a final consistent database/attachment backup.
4. Restore it on the VPS, verify it, then switch the tunnel origin or DNS and confirm OAuth URLs and email configuration.
5. Resume writes on one authoritative host. Keep the old host isolated/read-only for a defined rollback period.

Define rollback carefully: after the VPS accepts new writes, switching back to an old laptop snapshot would lose them. Preserve or migrate those writes before rollback. A basic single-server migration should assume a maintenance window.

## 10. Budget and decisions still needed

Keep infrastructure and AI inference budgets separate. Open-source application code does not make email, domain registration, backup storage, electricity, or model usage free.

For planning, propose an initial **infrastructure allowance of EUR 0–10/month plus a domain allowance of EUR 10–30/year**, depending on eligible free tiers, backup volume, and an existing domain. These are budget placeholders, not provider quotes, and exclude electricity, development time, subscriptions, and AI usage. Re-price the chosen services before purchase. A later VPS needs a separate quote based on measured RAM/storage requirements.

Cost controls: external AI clients first, bounded tool results, pagination, incremental block updates, upload quotas, log retention, backup retention, and no embeddings/LLM service until needed. Do not assume 6–7 GB VRAM can host the desired DeepSeek model effectively.

### Work I can perform within the project

- Refine architecture decisions, schemas, user stories, and acceptance criteria.
- Build the app, responsive editor, databases, API, and MCP server in this workspace.
- Add meaningful auth, authorization, save-conflict, and integration tests.
- Prepare Compose configuration, deployment scripts, `.env.example`, backup/restore scripts, and runbooks.
- Prepare open-source documentation, contribution guidance, security reporting instructions, and dependency notices.
- Configure and test deployments when NikDTM access and required accounts are available.

### Input or account actions needed from you

| Input | Why/when it matters |
| --- | --- |
| NikDTM OS, CPU, free SSD space, other uses, upload speed | Choose installation approach and resource limits before hosting |
| Whether an isolated Linux environment is acceptable | Decide host isolation; no OS replacement is assumed |
| Domain you own or want, and monthly spending ceiling | Stable HTTPS, email sender identity, and cost limits |
| First Google account to allow | Restrict the personal pilot |
| Google Cloud OAuth project, domain/DNS access, email service, backup destination | Production authentication, reachability, code delivery, and recovery |
| Preferred DeepSeek interface and cloud API versus local inference | Select/build the MCP host around DeepSeek |
| Whether Gemini CLI is acceptable or consumer Gemini is required | Define a verifiable Gemini integration route |
| Passkey/authenticator preference alongside the requested email code | Strengthen account protection and recovery |
| License preference and eventual commercial goals | Decide Raspberry's license and dependency constraints before publication |
| Sample Notion exports when import work begins | Establish realistic import coverage and fidelity |

Enter secrets through protected local configuration or the relevant account interface rather than posting them in chat. Account ownership, purchases, domain choices, and physical/remote access to NikDTM require your participation; code and configuration preparation can proceed beforehand.

**Recommended next action:** implement the Phase 0 prototype, then the smallest secure page-editor release. Resolve OS/access, domain/budget, and the DeepSeek/Gemini interfaces in parallel with local development. Keep this document updated with verified decisions and test results.
