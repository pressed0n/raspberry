# Raspberry — checklist

Short view. Every line is 2–4 words. Detail lives in `BACKLOG.md`.

`[x]` done · `[ ]` to do · `[~]` parked

**State:** 257/257 tests pass · typecheck clean · hosted nowhere · one user, one machine.

**Now focused on:** how it looks and feels, locally.

**Source of truth:** *Raspberry Update Wishlist* page in the app.

---

## To do

1. [ ] **B9** Database views (table, board)
2. [ ] **B21** More Notion blocks — *needs your block list*

---

## Parked

Everything here waits for an online server — reachable from other devices.

- [~] **B17** Callback origin bug
- [~] **B14** Playwright smoke flow
- [~] **B10** Attachments / uploads
- [~] **B11** Real search ranking
- [~] **B12** Retention pruning job
- [~] **B13** Workspace export / import
- [~] **B15** A11y + mobile audit
- [~] **B16** Invites, multi-user
- [~] **B4** Postgres in CI
- [~] **B5** Session / account UI
- [~] **B6** Remote MCP + OAuth
- [~] **B7** Email deliverability
- [~] **B8** Deployment runbook

**Cancelled, do not resurrect:** subdomain pilot · NikDTM · VPS migration.

---

## Done

### Foundation

- [x] Nested pages
- [x] Page titles
- [x] Page icons
- [x] Favorites
- [x] Full block set
- [x] Callouts + columns
- [x] Child-page blocks
- [x] Searchable page links
- [x] `:` slash menu
- [x] SQL-side search paging
- [x] Cascading trash
- [x] Batch subtree restore
- [x] 30-revision history
- [x] Autosave `409` reject
- [x] Idempotent receipts
- [x] Draft recovery
- [x] Markdown export
- [x] Page duplicate
- [x] Viewer restrictions

### Storage

- [x] Shared service layer
- [x] SQLite default
- [x] Postgres adapter
- [x] Versioned migrations
- [x] Cross-workspace denial
- [x] Backup script
- [x] Restore drill
- [x] Leak-free health check

### Security seam

- [x] Resolve actor once
- [x] Split transport/identity
- [x] Loopback guard

### Auth

- [x] Google OIDC
- [x] 6-digit email code
- [x] Pending login state
- [x] Hashed session tokens
- [x] Idle + absolute expiry
- [x] Constant-time verify
- [x] Logout
- [x] Code resend
- [x] Login rate limits
- [x] Never-fail audit log
- [x] `proxy.ts` early refuse
- [x] Session revocation
- [x] Revoke all sessions
- [x] Membership revoke

### Ops

- [x] Dev/preview wrappers
- [x] Windows sign-in task
- [x] systemd unit
- [x] CI on push
- [x] AGPL-3.0 license
- [x] Local MCP stdio
- [x] MCP write gate
- [x] Security policy

### P0 truth + cleanup

- [x] **B1** README corrected
- [x] **B1b** Stale comment fixed
- [x] **B2** Pilot deleted
- [x] **B3** "Nowhere" recorded

### Reskin

- [x] **B18** Reskin shipped
- [x] **B19** Fluff removed
- [x] **B20** Dark default + toggle

### Tabs

- [x] **B22** Page tabs — open, switch, close, reorder, restore on reload
- [x] **B23** Reorder glides instead of snapping

### Wishlist (from *Raspberry Update Wishlist*)

- [x] **B24** Breadcrumb trail
- [x] **B25** Sidebar page menu (⋯) — favourite, open in tab, rename, duplicate, move to, trash
- [x] **B27** Sidebar verbs fixed — favourite no longer blocks the page; trash can be searched, restored and emptied
- [x] **B28** Drag pages in the sidebar — ghost under the cursor, drop on a page to nest, drop between two to reorder (order is stored, so it survives a reload; `Alt ↑/↓` is the keyboard equivalent)
- [x] **B26** Media blocks — image, video, audio, file
- [x] **B26b** Paste an image from the clipboard, and drag one in, without hotlinking
- [x] **B30** Colour settings — Settings row bottom-left, a settings page, HSL control per colour for text and highlight/callout, a radial primary-colour picker, a separate green tick, and `prototype/color-lab.html` for tuning the defaults

### Database (from *Database Feature Wishlist*)

- [x] **B38** Database substrate — 16-type vocabulary with a Zod config schema each, migration 6 (databases / properties / views / cells, `pages.database_id`), a pure `load → filter → sort → group → window` pipeline, create/get/patch with `mutationId` replay, and a read-only table view. A row is a page, so rows get bodies, trash and search for free.
- [x] **B39** Property registry complete — all 16 types have a spec (`empty/coerce/isEmpty/compare/format/fits/aggregates`), one module per type in `src/lib/database/property-types/`; the registry is a full `Record`, so adding a vocabulary name breaks the build until its module exists. `readOnly` (createdTime, button) and `derived` (formula) are declared on the spec, not special-cased by views. 30 tests, `tests/database-properties.test.ts`.

---

## Settled

- [x] Personal Notion clone
- [x] Not commercial, no rivals
- [x] Single user for now
- [x] Sign-in test → when hosted
- [x] "2+ people" → later
- [x] "Pi name" → retired

