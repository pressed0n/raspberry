> **ARCHIVED — history, not guidance.** Superseded by [`docs/STATE.md`](../STATE.md).
> Kept unedited for the narrative of each item. Note: its "Active to-do" section was
> 11 of 14 headings describing already-shipped work, which is why it was retired.

# Raspberry — delivered work, active to-do, and parked backlog

Verified **28 October 2026** at commit `4f9136e` plus the P0 changes below.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean (exit 0) |
| `tsx --test tests/*.test.ts` | **248 passed, 0 failed** (23 files) |
| Git tree | 4 untracked files: `BACKLOG.md`, `CHECKLIST.md`, 2 probe scripts — no source changes pending |
| Deployment | **none. Not hosted anywhere, and no hosting target.** |

Everything under **Delivered** was confirmed by running the suite or by reading
the code, not by trusting an earlier summary.

---

## Where Raspberry runs

Raspberry is **hosted nowhere**. The third-party hosting pilot was cancelled on
28 October 2026 and its files were deleted; the research behind it stays in
`RASPBERRY_PLAN.md`, marked inactive. The app is a single-machine, single-user,
loopback-only workspace. That is the intended shape until the owner says
otherwise.

Nothing in this file should be read as preparing a deployment. If hosting ever
returns, it comes back as a new decision, not as resumption of an old plan.

---

## 1. Delivered

### Foundation — `d711b5e`

- [x] Nested pages with per-page title, icon, and favorites.
- [x] Full BlockNote block set, including callouts and 2–5 column layouts.
- [x] Inline child-page blocks, searchable page links, and the `:` slash menu.
- [x] Search paginated **in SQL**, so filtering a capped result set cannot lose
      children (`2e15e64`).
- [x] Cascading trash with batch restore of a whole subtree.
- [x] Revision history capped at 30 entries, restorable.
- [x] Autosave that returns `409` on a stale revision instead of overwriting.
- [x] Idempotent mutation receipts, so an exact retry is safe.
- [x] Editor draft recovery after a failed save or a closed tab.
- [x] Markdown export, page duplication, and viewer restrictions.

### Storage and service layer — `7c05ebb`

- [x] One service layer shared by HTTP, MCP, and the stdio entry point, so
      authorization is written once.
- [x] SQLite by default; PostgreSQL adapter selectable via `DATABASE_URL`.
- [x] Versioned migrations in `src/server/migrations.ts`, with tests.
- [x] Cross-workspace access denial covered by tests.
- [x] Backup script and a live restore drill that reopens the WAL-backed copy.
- [x] Health endpoint that leaks nothing (`GET /api/health`, liveness only).

### Security seam — `a78e4cc`

- [x] The caller is resolved exactly once, at `resolveActor()`.
- [x] Transport admission (`requestAccessError`) is separated from identity
      admission, so "is this request allowed in?" and "who is calling?" cannot
      be confused.
- [x] Loopback guard for local mode, which fails closed against DNS rebinding
      and cross-origin reads and writes.

### Authentication — `2e62e43` … `4f9136e`

- [x] Google OpenID Connect followed by a six-digit emailed code.
- [x] Pending-login state that cannot read pages or issue MCP credentials.
- [x] Session tokens hashed at rest; the raw secret is never stored.
- [x] Idle expiry plus an absolute lifetime that activity cannot extend.
- [x] Opaque cookie, constant-time verification, malformed tokens refused
      without touching the database.
- [x] Logout, code resend, and rate limits on both.
- [x] Audit trail that can never fail a login.
- [x] `proxy.ts` refuses a sessionless request before any database work.
- [x] Store-level `revokeSession`, `revokeAllForUser`, `pruneSessions`.
- [x] Losing membership invalidates the session instead of defaulting a role.

### Operations and hygiene

- [x] Dev and preview wrappers; `scripts/serve.mjs` fails closed in session mode.
- [x] Windows sign-in scheduled task with automatic restart; `Start-Raspberry.cmd`.
- [x] systemd unit for Linux (`deploy/raspberry.service`).
- [x] CI on every push: typecheck, tests, and both deployment shapes (`1801afe`).
- [x] AGPL-3.0-only (`09a8920`), `THIRD_PARTY_NOTICES.md`, `.gitattributes`,
      `SECURITY.md`, `AGENTS.md`.
- [x] Local MCP over stdio, read-only by default, writes gated behind
      `RASPBERRY_MCP_WRITE`; SDK client negotiation covered by a test.
- [x] A stray committed API error body removed (`452572e`); pagination and
      save-loop defects fixed with regression tests (`2e15e64`, `b981c4b`,
      `e0c9977`).

### P0: repo truth and cleanup — completed 28 October 2026

- [x] **B1 — README no longer lies.** The status line claimed authentication was
      upcoming; the access-mode table marked `session` mode as **Refused**; the
      milestones listed sign-in as future work; and SQLite was described as
      having no migration tooling. All four corrected against the code.
- [x] **B1b — stale comment in `src/server/access.ts` corrected.** It stated that
      session mode "intentionally never returns null" and that a session lookup
      was "the whole of the remaining access work". Both false: the function
      returns `null` on transport success, and sessions shipped.
- [x] **B2 — cancelled hosting pilot deleted.** `deploy-raspberry/`, `lib/`, and
      four `scripts/mashina-*.ps1` files removed. No tracked file referenced them.
      An archived copy sits at `artifacts/cancelled-hosting-pilot-20261028.zip`
      (10,773 bytes, 9 entries, sha256 `640F91A9…B170A0`) — gitignored, deletable
      whenever the owner is satisfied nothing is missed.
- [x] **B3 — "nowhere for now" recorded** at the top of `RASPBERRY_PLAN.md`, with
      sections 4 (hosting on NikDTM) and 9 (cloud VPS migration) marked inactive.
- [x] **B18, B19, B20 — reskin, fluff removal, dark default with a toggle.** Built
      as a standalone prototype first (`prototype/`), approved, then ported into
      `src/`. Detail and the traps are in section 2a. Verified after the port:
      `tsc --noEmit` clean, 88/88 tests pass, and both themes and the mobile
      breakpoint checked in a real browser.

---

## 2. Active to-do — Notion parity

Refocused **28 October 2026** by owner decision. Hosting is off the table, so
everything that only matters once Raspberry is reachable from another device
moved to section 3. Stated purpose: a personal Notion clone. Not commercial, no
competitor, one user.

**B18, B19 and B20 shipped on 28 October 2026** — see "Reskin" in section 1.
What is left is feature work, in the owner's order.

1. ~~**B25 — sidebar page menu.**~~ **Shipped 28 October 2026.** See below.

2. **B26 — media blocks.** Owner's wishlist, third item: image, video (upload or
   YouTube link), audio with a player, general file upload. Blocked on the same
   three-coordinated-changes rule as B21 (editor registration, server allowlist,
   render path) *plus* storage, so it implies B10 (attachments) becoming real.

3. **B9 — database views.** Owner's words: "database functionality like in Notion
   (table view, board view, etc)". Properties beyond title and icon, then table
   and board rendered from stored view definitions. Calendar is a third view type
   and can follow. Needs a schema migration plus a query layer per view type, so
   it is the largest single item on this list.

4. **B21 — more Notion blocks.** Owner will supply the block list; **do not guess
   at it**. Existing JSON validation only accepts block types the editor enables
   and fails loudly on anything else, which is the right behaviour and means each
   new block needs three coordinated changes: editor registration, server-side
   validation allowlist, and render path. Batch by block family rather than one
   block per commit.

5. ~~**B22 — page tabs.**~~ **Shipped 28 October 2026.** See "Tabs" below.
6. ~~**B24 — breadcrumb trail.**~~ **Shipped 28 October 2026.** See below.
7. ~~**B28 — drag pages in the sidebar.**~~ **Shipped 28 October 2026.** See below.

The owner's live list is the page **"Raspberry Update Wishlist"** in the app,
read from `data/raspberry.sqlite`. It is the source of truth for order; this file
records why each item is shaped the way it is.

### B30 — colour settings: the palette becomes data

Shipped 29 October 2026, from *Colour options settings* on the wishlist page.

**The bug that made this a refactor rather than a form.** `globals.css` declared
the nine block colours as literals *three times over* — on `:root[data-theme]`,
on `.bn-container` and on `.bn-editor`, because BlockNote's own `.bn-container.dark`
rules force that depth. A custom property declared on an element **beats one
inherited from `:root`**, so writing overrides on the root element would have been
silently ignored inside the editor. The probe caught it: the root variable read
back `#d5ee81` while the coloured word in the document still rendered `#ee8181`.

`globals.css` now maps BlockNote's names onto `--palette-*` tokens that are
declared **only on `:root`** (in `theme.css`). One property on the root element
now reaches every block. `tests/palette.test.ts` fails if a literal hex ever
creeps back into that block, which is the exact regression this cost a day to.

Files: `src/lib/palette.ts` (model: HSL in, hex out, 23 tests),
`src/lib/settings.ts` (storage + runtime + pre-paint), `src/components/settings-page.tsx`,
`src/components/settings/{controls,preview}.tsx`, `src/app/settings/page.tsx`,
`src/app/settings.css`, plus `prototype/color-lab.html`.

Decisions worth keeping:

- **HSL is the storage format, hex is the output.** Round-tripping hex → HSL →
  hex drifts a unit per channel on the eight-bit grid, and a slider that jumps
  from 71 to 72 while you drag it feels broken. `DEFAULT_PALETTE` is the source of
  truth; the stylesheet is its projection, and a test parses the CSS to prove it.
- **Two editable groups, not three.** BlockNote paints a highlight and a callout
  from the same `*-background` / `*-text` pair, so "highlight colours" and "callout
  colours" are one thing. Two controls would fight over one variable.
- **Hue links, lightness does not.** *Move hue together* carries a hue edit to the
  sibling group and leaves lightness alone — a fill at text lightness is unreadable.
  It only propagates on an actual hue change, because the defaults are not
  hue-matched (red text is 0°, red fill is 350°) and propagating on a saturation
  edit would rewrite a colour nobody touched.
- **The tick has its own token.** A tick that follows the accent turns red for a
  red accent, and a red tick reads as *problem*, not *done*. Default green.
- **Only overrides are written to the DOM.** Applying the full palette looks
  identical but leaves the document holding values equal to the stylesheet — so
  Reset could never reset, and a future default change would never arrive.
- **The pre-paint cache holds no default material.** Each save also stores the
  derived custom properties, filtered to the keys that actually differ. The
  `<script>` in `<head>` therefore applies six keys instead of duplicating the
  colour maths, and changing a default cannot leave a stale value in it.

New defaults: text near 70% lightness keeping its saturation (they are for
highlighting a word, not tinting it), fills at ~17-20% lightness in the same hue,
accent unchanged, tick green. Light theme tuned separately — a fill that works on
`#0d0c0c` is not a fill that works on `#fff`.

`src/app/settings/page.tsx` is a real route, reached from a **Settings** row at the
bottom-left of the sidebar. Verified with `scripts/cdp-settings.mjs` — **37 checks
at 1400 and 390**, real mouse for the slider drags, ring clicks and sidebar row.
It creates a coloured-block fixture through the API, proves the *stored* palette
repaints a word that already exists, and purges the fixture afterwards.

`prototype/color-lab.html` is the standalone tuning document the wishlist asked
for first: nine colours × two groups × H/S/L, the radial accent picker, the tick,
a live preview and an import/export record. It duplicates the HSL maths on purpose
— a design tool that needs a bundler is not a design tool.

### B31 — settings becomes a dialog with a menu

Shipped 29 October 2026. Two changes, one of them the owner's: settings is a
**modal over the workspace** rather than a route, and the defaults are now the
palette the owner tuned in the lab.

**Why the container changed.** Settings is something you glance at *while*
working. As a route it threw the page you were reading out of the viewport to
show you a form, and the thing the preview exists to let you judge was the thing
that disappeared. The modal keeps the page visible behind a scrim.

- `src/components/settings/dialog.tsx` (was `settings-page.tsx`) renders inside
  the shared `Modal` — same scrim, same Esc, same focus trap — with a new
  `variant="settings"` and an `actions` slot in the header. `.panel-settings` is
  1120×860, three columns: menu, section, preview. Only the middle column scrolls.
- The left menu is `SETTINGS_SECTIONS` in **`src/lib/settings-nav.ts`** (pure,
  7 tests). The panels are typed as `Record<SettingsSectionId, …>`, so a section
  with no panel behind it is a compile error, not a dead tab.
- `/settings` survives as a redirect to `/?settings=1`; the workspace opens the
  dialog and drops the parameter. A bookmarked old URL is not a 404.
- The sidebar row is a `<button>` again, not an anchor.

**Two bugs found by driving it.** The shared `Modal` effect depended on `onClose`,
and every caller passes an inline arrow — so the trap re-ran on every render and
its cleanup moved focus back to whatever was focused before the dialog. In a
settings screen with a keyboard-navigable menu that steals the keyboard mid-use;
it is now a ref with `[]` deps. And at 390px the flex column let `.set-panels`
shrink under its own content, so the preview painted **over** the sliders —
`elementFromPoint` on a slider returned `.preview`. Fixed with `flex: 0 0 auto`
on the shell's children and one scrolling column.

Verified with `scripts/cdp-settings.mjs` — **53 checks at 1400 and 390**, real
mouse and keys: the row opens a dialog without navigating, the workspace is still
behind it, four sections, menu on the left edge, panel switching, the preview
surviving a switch, ArrowDown moving down the menu, Escape closing, the panel
containing its own scroll, and `/settings` redirecting.

**New defaults** (owner's tuned record, pasted via the dialog's *Copy record*):
dark text `brown 24/57/65 · green 145/76/72 · blue 210/100/76 · purple 250/100/81
· pink 326/90/80`; dark fills `brown 24/30/14 · blue 210/46/19 · purple 250/40/20
· pink 326/31/19`; accent `0/79/71`; tick `145/52/58`. `theme.css` is generated —
`scripts/gen-palette.mjs` prints the block, and `tests/palette.test.ts` fails if
the sheet and `palette.ts` disagree.

### B37 — right-click a sidebar row opens the page menu at the pointer

Shipped 30 October 2026. Right-clicking a page row opens the same menu the `⋯`
opens — one component, one item list, no second dropdown to drift.

**The work was placement, not plumbing.** `⋯` anchors to a *button*: the menu's
right edge meets the button's, because the button sits 8px from the edge of a
264px sidebar. A right-click anchors to a *point*, and there the click is the
only thing telling you what you targeted — so the menu's top-left corner must sit
on it, with no gap. One function now decides both:

- **`src/lib/menu-place.ts`** (pure, 13 tests) — `placeMenu(anchor, size,
  viewport)`, with `align: "end" | "start"` and `gap`. `page-menu.tsx` reads the
  rect and asks for numbers instead of holding the arithmetic inline. The clamp
  keeps the original `max(lo, min(v, hi))` order on purpose: the natural-looking
  `Math.min(Math.max(…))` silently changes what happens when the menu is wider
  than the viewport, and a test states both the old numbers and that case.
- `openRowMenu` is separate from `toggleRowMenu`. A second right-click on the
  same row means "put it here instead"; a toggle would close it, which reads as
  the click being ignored.
- One `rowContextMenu` handler on both `.tree-row` renders (tree and favourites).

**Two refusals inside that handler.** A right-click inside the rename field is
left to the browser — swapping the field's cut/copy/paste menu for six page
verbs would make renaming the one place in the sidebar where editing text gets
harder. And a `(0, 0)` contextmenu — the keyboard menu key, Shift+F10 — anchors
to the row's own rect instead of opening in the viewport's top-left corner.

Verified with `scripts/cdp-favtrash.mjs` §7: **32 checks at 1400, 900 and 390**,
including that the native menu is cancelled (`dispatchEvent` returns false — the
only observable proof, since headless never renders one), that the menu lands on
the click rather than the `⋯` rect, that the verbs are identical, that re-aiming
moves it instead of closing it, that edge cases flip and clamp, that a verb
actually runs, and that right-click neither navigates nor arms a drag. `tsc` 0,
282 unit tests, `cdp-drag` unchanged.

**Two things measured rather than assumed.** Geometry read in the same frame as
the open is the menu's *animated* position — `layer-in` animates a transform, so
the rect was up to 3px off until the assertions waited for the animation. And at
390px the rename field closes itself ~1.2s after opening, with the drawer
following 100ms later; the timer predates the contextmenu event in a state trace,
so it is a pre-existing mobile sidebar behaviour and is **not fixed here** — the
test fires on the first frame the field exists rather than waiting it out.

### B28 — sidebar drag: reorder and nest

Shipped 28 October 2026. Rules in **`src/lib/sidebar-drag.ts`** (pure, 14 tests in
`tests/sidebar-drag.test.ts`), ordering and the move endpoint (10 tests in
`tests/positions.test.ts`), gesture in `workspace.tsx`, ghost and insertion line in
`src/components/drag-layer.tsx`, styles in `shell.css`.

**The order had to become data first.** Until now the sidebar's order *was* `created_at`:
`list()` sorted by it, `position` did not exist. A drag that reordered would have survived
one render. Migration 4 adds `position`, scoped to siblings (two pages under different
parents may share a number), and backfills densely **in the order each parent was already
drawn** — a migration that visibly reshuffles someone's sidebar is indistinguishable from
a bug. Verified against the pre-migration database: 4 parent groups, 0 changed.

`POST /api/pages/:id/move` is a new sub-path rather than a field patch, because a move
renumbers every sibling of the destination in one transaction, and `index` only means
something relative to the list it lands in.

Three decisions worth keeping:

1. **Only the moved page's revision advances.** Renumbering a neighbour is not editing it;
   bumping its revision would 409 any editor open on a page whose content did not change.
2. **`adoptMove` in the draft registry.** The move bumps the server revision while an open
   record still holds the old one — the exact 409-then-`blocked` lockout from B27, arrived
   at from a new direction. The probe types into a page, drags it, types again, and asserts
   it still saves.
3. **Row geometry is frozen when the gesture arms**, and the dragged subtree is excluded
   from hit testing entirely. Measuring a live layout mid-drag is what made the B23 tab drag
   jitter; and a drop the UI draws as legal must land, so the cycle is made invisible rather
   than refused after the user lets go.

**Known gap:** the tree does not autoscroll, so a drop target below the fold needs the list
scrolled to it first. `Alt ↑/↓` moves the active page among its siblings and covers the case
in the meantime.

### B25 — sidebar page menu

Shipped 28 October 2026. Rules in **`src/lib/sidebar-menu.ts`** (pure, 10 tests in
`tests/sidebar-menu.test.ts`), menu in `src/components/page-menu.tsx`, destination
picker in `src/components/move-picker.tsx`, styles in `shell.css`.

**The server had to change first.** A page's parent was not writable: `parent_id`
existed in the table, but `patchPageSchema` had no `parentId` and `updatePage` never
wrote the column. "Move to" cannot be faked on the client because the tree *is*
`parent_id`. So the schema gained `parentId` (nullable, so `null` means "top level"
rather than "unchanged") and `updatePage` gained a cycle guard: moving a page into
itself or a descendant is refused with 409 `would_cycle` before any write. That
guard matters because the failure is silent and unrecoverable — the subtree keeps
pointing inside itself and simply stops being drawn, while the rows still exist.
9 tests in `tests/move.test.ts` cover it, including that a refused move writes
nothing.

Three decisions worth keeping:

- **One `⋯` component, two call sites.** The tree rows and the favourites shortcuts
  both render it. They were separate for one commit and immediately drifted: the
  favourites row had no menu at all, and the probe caught the resulting duplicate
  rows by title. A page you can right-click in one place and not another teaches
  you not to trust either.
- **Destinations are removed, not disabled.** `moveTargets` drops the moving page
  and its subtree from the list before flattening, so an illegal move cannot be
  picked. The current parent stays visible but inert, because a silently missing
  option reads as a bug.
- **Every write flushes first.** Rename, move, favourite and trash all carry
  `expectedRevision`; the sidebar's copy of a page is stale the moment it has
  pending edits, so acting on it would 409 on the page you were most recently
  typing in. `settleRecord` saves and reports; `renameRecord` writes the title
  through the open editor's draft so the editor cannot save the old name back over
  it.

Two things the browser found that reading the code did not:

- **The menu rendered behind the mobile drawer.** The portalled menu used the crumb
  menu's `z-index: 80`; the drawer is `96` and its scrim `95`. On a phone the menu
  was visible and every click on it hit the sidebar underneath. `.page-menu` is now
  `97` — above the drawer, still below `.scrim` (100).
- **A `Del` / `F2` hint was written into the menu before anything bound those keys.**
  Removed. Same rule as the `Ctrl N` label from B22: a menu that advertises a key
  that does nothing is worse than one that advertises nothing.

Verified by `scripts/cdp-sidebar.mjs` with real mouse input at 1400 and 390 —
18 checks, all passing: hover reveal, six verbs, portalled placement, favourite
round-trip, inline rename commit, duplicate beside its source, move excluding self
and descendants, the subtree travelling with the page, sidebar re-nesting, open in
new tab, and trash closing the page's tab.

Known litter: the probe creates and trashes fixtures on every run, so **Trash is
mostly probe pages** (147 entries at last count). There is no purge endpoint.

### B24 — breadcrumb trail

Shipped 28 October 2026. Rules in **`src/lib/crumbs.ts`** (pure, 14 tests in
`tests/crumbs.test.ts`), UI in `src/components/crumbs.tsx`, styles in `shell.css`.

Three decisions worth keeping:

- **Ancestors only; the current page is not in its own trail.** A trail of one is
  the title written twice, which is what B19 deleted from the topbar. So a root
  page renders no row and gains no height.
- **The row lives inside `.doc`, not in the topbar.** The topbar already owns a
  scroll edge (a fade, `shell.css`). A second fixed row would put that fade over
  the crumbs and add a hairline the reskin spent B19 removing.
- **Narrow screens spend one slot fewer** (`COLLAPSE_AT_NARROW`). Measured at
  390px: four crumbs truncated evenly to `All Blo… / New page, more i… / Untit… /
  crumb pro…`, losing the immediate parent — the one crumb you reach for. The
  last slot now keeps its natural width and earlier ones give way.

Verified with `scripts/cdp-crumbs.mjs` at 1400 and 390: real mouse input for the
click and Ctrl+click, root page, collapse boundary, the `⋯` menu, and Escape.

Every item here is a UI change with **no automated proof the app renders** — see
B14 in section 3, which is the one parked item I would argue against parking.

### B22 — what shipped, and the two pieces worth understanding

Rules live in **`src/lib/tabs.ts`** as pure functions (`openTab`, `closeTab`,
`moveTab`, `pruneTabs`, `restoreTabs`, `parseTabs`) with **32 tests** in
`tests/tabs.test.ts`, including a 2,000-step randomised check that the invariants
(`ids` unique, `active` always a member) survive any sequence of operations. This
is the first client-side test in the suite; the other 88 are service-level.

**`src/lib/draft-registry.ts`** is the part that is not obvious. A page's unsaved
work used to live inside `usePageDraft`, so it died when the editor unmounted — and
a tab switch unmounts the editor. The old single-page code hid that behind a
`localStorage` recovery path: every switch threw away the pending 700ms save timer
and flashed "Recovered your unsaved draft." Draft state now lives in a record keyed
by page id that outlives the mount. The save semantics are unchanged — the same
`draft-sync` primitives are called the same way. **Do not fold this back into the
hook**; the thing that would break is silent, not loud.

Deliberately **not** preserved across a switch: undo history (the editor really
does unmount). Scroll is captured per tab and restored by hand, verified round-
tripping at 606px.

Behaviour, matching the owner's answers:

| | |
|---|---|
| Sidebar click | Reuses the current tab |
| Ctrl/⌘-click, middle-click | Opens in a new tab |
| Creating a page | Appends a tab — creating should not cost you your place |
| Reload | All tabs + the active one restored (`raspberry:tabs` + URL hash) |
| Drag | Reorders live; order persists |
| Shortcuts | `Alt 1–9`, `Alt W`, `Alt N`, `Alt ⇧ ← →` |

Fixed on the way: the sidebar advertised **`Ctrl N`** for New page and bound
nothing. Ctrl+N cannot be intercepted in Chrome at all, so the hint would have
stayed a lie even with a handler. It is `Alt N` now and the key works.

Known limitation: **reordering is a mouse/trackpad affordance.** The tab sets
`touch-action: pan-x` so a phone can still scroll the strip, which means a touch
drag scrolls instead of reordering. `Alt ⇧ ← →` is the keyboard equivalent.

Also observed and left alone: the strip is empty in the server-rendered HTML
because tab state is read on the client. It fills within a frame; there is no
layout shift, since the topbar height is fixed and the strip is `flex: 1`.

---

## 2a. What the reskin replaced (kept for the next session)

Prototype: `prototype/index.html` (+ `styles/`, `README.md`, `index-empty.html`,
`mobile.html`). Kept because it is the only record of the alternatives that were
tried and rejected — the serif title, the graphite default, the single accent.

Files that now carry the design, all new except `globals.css`:

- `src/app/theme.css` — tokens, dark and light, the only place colour lives.
- `src/app/shell.css` — app frame: sidebar, topbar, document frame, panels, menus.
- `src/app/document.css` — static document typography (title, meta, empty state).
- `src/app/globals.css` — rewritten. Editor surface: BlockNote `--bn-*` mapping,
  callouts, columns, page references, pickers, sign-in.
- `src/lib/theme.ts` — theme read/write plus the pre-paint bootstrap script.

Three things worth knowing before touching this code:

1. **BlockNote's colours cannot be set through its `theme` prop here.** The prop
   writes inline custom properties on the editor root, which then need a JS round
   trip per toggle. Instead `--bn-*` variables are declared in CSS under both
   `:root[data-theme]` **and** `:root[data-theme] .bn-container`. The second
   selector is required: `@blocknote/react` ships a dark palette on
   `.bn-container.dark`, so a root-only declaration loses.
2. **`theme="dark" | "light"` is still passed to `BlockNoteView`** — not for the
   colours but for `data-mantine-color-scheme`, which the portalled slash menu and
   emoji picker read.
3. **`calloutColors` in `src/lib/document.ts` includes `pink`**, which BlockNote
   does not ship a highlight for. `globals.css` defines pink and brown explicitly;
   without them those callouts render transparent.

Removed, as decided: `YOUR SPACE TO THINK`, the fake author avatar, the tagline and
its leaf, the `P` workspace block, two of three create-page buttons, the breadcrumb
that repeated the title, five poem-shaped modal headers, decorative dots and rules.
Kept: save state, word count, favourites, trash, page icon, export, duplicate,
history, delete, sign out, and the honest `Local only` label.

Still open from the prototype: the mobile drawer's scrim sits above the translucent
topbar in headless Chrome. Z-index says it should not. If it reproduces in a real
browser the fix is `.app.is-open .topbar { backdrop-filter: none }`.

---

## 2b. B27 — favourites and trash, and the bug behind both

The side menu advertised six verbs. Two of them were wrong in ways the old probe
could not see, because it only ever acted on a page that was **closed**.

**Favouriting a page used to break it.** The `⋯` sent a PATCH straight to the API.
A page that is open in a tab also has a *draft record* (`src/lib/draft-registry.ts`)
holding the revision it last saw. The direct write moved the server on by one and
left the record behind, so the editor's next save carried a stale revision:

1. 409 `revision_conflict` on the first save after favouriting.
2. That conflict sets `record.blocked`, which is sticky — the page could not be
   saved again for the rest of the session.
3. Every later verb on that page failed with "unsaved changes that could not be
   saved", and un-favouriting was impossible.

Fixed by routing the write through the record (`favoriteRecord`), the same way
rename already worked. A closed page has no record to keep in step, so that path
reads the page first and writes against the revision it was just handed.

The same "guess the revision" pattern was in `trash`. It now reads the current
revision when the page is not open.

**The trash could only grow.** `trash` was the only deletion the server had, so
182 rows had accumulated with no way to remove any of them. B27 adds:

- `DELETE /api/pages/:id/purge` — permanent, only for trashed rows, takes the
  trashed subtree, and detaches any live page that pointed at the parent (a
  foreign key means the parent cannot go otherwise).
- `DELETE /api/trash` — empties it.
- A rebuilt panel: search, a count, the deletion date, the parent's name, a
  two-step "Delete forever", and "Empty trash" that arms before it fires.

**A refusal nobody could see.** Restoring a page whose parent is still in the trash
is refused by the server (`parent_in_trash`). The panel put that error in the
app-wide banner, which renders *behind* the modal — so the button looked dead. The
row now says "restore its parent first" and does not offer the button at all.

**Found while verifying at 390px:** `.app.is-open .scrim-side` set `position` and
`z-index` but never `display`, and the base rule is `display: none`. The mobile
drawer therefore had **no scrim** — nothing dimmed, nothing tappable — and since
the hamburger only ever calls `setSidebar(true)`, a phone had no way back to the
page it was reading. One line: `display: block`.

Verification: `scripts/cdp-favtrash.mjs` — 14 checks at 1400 and 14 at 390, all
passing, driven with real mouse and keyboard input. `tests/purge.test.ts` — 7
server tests. 168/168 in total.

## 3. Inactive backlog (parked)

Parked **28 October 2026** on one condition, stated once rather than repeated per
item: *nothing here is worked on until Raspberry runs on a server reachable from
other devices.*

The owner's instruction was to park the entire former to-do list on that basis. My
honest read of that instruction, recorded so it is not lost: most of these items do
not actually require a server. Two groups below, and the split matters if the
parking is ever revisited.

### Hosting-gated — genuinely waits for the server

- **B17 — callback redirect origin.** The bug only manifests behind a
  TLS-terminating proxy, where `request.url`'s origin is the internal socket, so a
  failed sign-in redirects somewhere the user cannot reach. No public origin, no
  bug. *Un-parks with* hosting. Detail in section 6.

- **B6 — remote MCP over HTTP with OAuth and per-tool scoping.** stdio is local by
  construction and needs no network authorization; remote MCP does, plus consent
  screens, grant storage, and per-client revocation. *Un-parks when* an AI client
  must reach Raspberry from another machine — which requires the server.

- **B7 — email deliverability.** SPF, DKIM, DMARC, bounce handling, suppression
  lists. An emailed code in a spam folder is a total second-factor outage and no
  test can prove deliverability. *Un-parks if* emailed codes ever serve real
  users; needs a real domain.

- **B8 — deployment runbook.** TLS termination, encrypted off-host backups,
  verified recovery after reboot, monitoring, signed-commit link from the running
  site to the served source. *Un-parks only* as step 1 of a new hosting decision.

- **B5 — session and account management UI.** `revokeSession`,
  `revokeAllForUser` and `pruneSessions` all exist and are tested; no UI reaches
  them. Irrelevant with one device. *Un-parks with* B16, or the first second device.

- **B4 — PostgreSQL adapter under the test suite.** Every test runs SQLite, so the
  adapter is unverified code — disclosed as such in the README. Pointless while
  SQLite is the only intended store. *Un-parks when* Postgres becomes a live option.

- **B16 — invitations, multiple workspaces, multiple users.** Schema supports
  membership already; adapters reach one seeded owner. *Un-parks when* a second
  person should see a page.

### Parked by instruction, though local-only

These need no server. Listed separately so nobody later believes a deployment is
the prerequisite.

- **B14 — one Playwright smoke flow.** Log in, create a page, edit a block, reload,
  confirm persistence, search for it. All 88 tests are service-level, so nothing
  currently proves the app renders or that API and UI agree. **This is the one
  parked item I would argue against parking**: section 2 is six consecutive UI
  changes and this is the only harness that would catch a broken render. Runs
  perfectly well against `localhost`.

- **B10 — attachments and uploads.** No binary storage of any kind. Storage
  location, size and type limits, orphan cleanup, and whether files live beside the
  SQLite file or inside it. Local-only work.

- **B11 — real search.** Today a case-insensitive substring `LIKE` with a 200-page
  cap. Needs ranking, eventually SQLite FTS5. Stops being cheap once there is
  content worth searching.

- **B12 — retention and pruning.** Revisions capped at 30 with no pruning job;
  receipts and sessions grow unbounded. Needs a scheduled prune and a definition of
  "old" per table.

- **B13 — whole-workspace export and import.** Per-page Markdown export exists.
  Import is the harder half — pick one target format, document what cannot survive.

- **B15 — accessibility and mobile audit.** Checked once by hand at a 390-pixel
  viewport. Nothing against a screen reader, keyboard-only navigation, or contrast.
  Overlaps heavily with B18, which is a reason it will resurface during the reskin
  whether parked or not.

**Explicitly cancelled, do not resurrect without a new decision:** the
third-party subdomain hosting pilot, the NikDTM hosting plan, and the cloud VPS
migration. See the decision banner in `RASPBERRY_PLAN.md`.

---

## 4. Known limitations, stated plainly

- One user, one workspace, loopback only. Not reachable from another machine.
- No attachments or binary storage of any kind.
- Search is substring matching, capped at 200 pages per listing.
- No live collaboration; concurrent edits resolve by revision rejection (`409`).
- 1 MB HTTP write bodies, 2,000 blocks, ten nested block levels.
- The JSON validator only accepts block types the editor enables, so an unknown
  block fails loudly rather than being silently dropped — intentional, but it
  means hand-edited documents can be refused.
- Authentication has never run against a real mail provider or a public origin.
- Nothing has been verified on a screen reader, and nothing on mobile beyond one
  manual check.

---

## 5. Questions for the owner — answered 28 October 2026

Kept rather than deleted, because the answers justify the current plan and would
otherwise be re-asked.

1. **Does it serve more than one person?** *Not for now.* Answered "not sure what
   this relates to" — the question existed because B16 (invitations, multiple
   users) is cheap to build early and expensive to retrofit. Answer: **one user.**
   B16 is parked, and the honest note is that identity retrofits stay expensive
   whenever that changes.

2. **Is the Raspberry Pi angle literal?** **Retired as a question.** It mattered
   only because `deploy/` contains both a systemd unit (Linux) and a Windows
   sign-in task, and one of them is inert. With hosting parked, neither is in play;
   nothing is being deployed, so nothing needs to be reconciled yet.

3. **What is this ultimately for?** **A personal Notion clone, for the owner's own
   notes.** Not commercial, not competing with Notion, not a demonstration of an
   AI-native workspace for anyone else. This is the load-bearing answer on this
   page: it is why hosting, multi-user, deliverability and deployment all parked
   without loss, and why B9 (database views) is now core product rather than an
   optional extra.

4. **Real Google sign-in test?** **Not yet — when the server goes online.** The
   owner's words. So the boundary in section 6 stands: everything testable without
   Google and without a mailbox has been tested, and no browser sign-in has ever
   completed against this build.

**B17** is no longer an open question — it is a confirmed defect, parked in section
3 because it cannot manifest without a public origin. Detail at the end of section 6.

---

## 6. How to check the authentication claim yourself

"Authentication works" is a claim with a boundary. It is verified at three levels,
and only the first two can be seen on this machine today.

### Level 1 — the test suite (repeatable, no setup)

```powershell
$node = ".\.tools\node-v24.22.1-win-x64\node.exe"
& $node node_modules\tsx\dist\cli.mjs --test tests\*.test.ts
```

Last run, 28 October 2026: **88 pass, 0 fail**, of which 45 cover authentication,
sessions and access (`auth-login`, `session-store`, `access`). These prove the
logic: PKCE and state verification, the allowlist, the second factor, session
hashing, idle and absolute expiry, revocation, and every transport refusal.

They do **not** prove Google is reachable or that email is delivered, because
`tests/auth-login.test.ts` injects a `fetchImpl` stand-in and an in-memory mailer.
That is deliberate — a test that needs the network is a test that fails for the
wrong reason — but it means the suite is evidence about code, not about the world.

### Level 2 — live HTTP, no credentials needed (repeatable)

Two probe scripts were written for this on 28 October 2026. Neither touches your
real notes: the session probe runs against a throwaway database in `%TEMP%`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-session.ps1
```

What they demonstrated, and what you should see again if you run them:

| Check | Result |
| --- | --- |
| `serve.mjs` in session mode with no config | refuses to start, exit 1, listing all six missing values |
| local mode, `GET /api/health` | `200 {"status":"ok","database":true}` |
| local mode, `GET /api/pages` | `200` with real page JSON |
| session mode, plaintext request | `403 Hosted requests must arrive over HTTPS.` |
| session mode, no cookie, `GET /api/pages` | `401 You are not signed in.` |
| session mode, no cookie, `GET /` | `307` → `/login` |
| session mode, wrong `Host` | `403 This host is not allowed.` |
| session mode, forged session cookie | `401`, treated as signed out, no crash |
| session mode, `POST` with no `Origin` | `403 A same-origin browser request is required.` |
| session mode, `POST` with cross-site `Origin` | `403 Cross-origin requests are not allowed.` |
| session mode, forged OAuth state | refused, no session issued |
| `GET /api/auth/google/start` | `303` → `accounts.google.com` with `code_challenge_method=S256` |
| `GET /login` | `200`, real page: "Continue with Google" |

The gate is real and it fails closed. That is the strongest thing that can be said
without credentials.

### Level 3 — a completed sign-in (not possible here yet)

There is **no `.env.local`** on this machine and no Google OAuth client, so
nobody has ever signed in to this build through a browser. Claiming otherwise
would be wrong. To close that gap you need, in `.env.local`:

- a Google Cloud OAuth client whose redirect URI is
  `<RASPBERRY_PUBLIC_ORIGIN>/api/auth/google/callback`
- `RASPBERRY_PUBLIC_ORIGIN` — must be `https`, so a local test needs
  `https://localhost:3000` and a trusted certificate
- `RASPBERRY_MAIL_ALLOW_CONSOLE=1` to print the 6-digit code to the terminal
  instead of sending it
- `RASPBERRY_ALLOWED_EMAILS`, `RASPBERRY_MAIL_FROM`

Until that is done, treat "sign-in works" as *"every part of sign-in that can be
tested without Google and without a mailbox has been tested."*

### B17 — the one defect live probing found

In `src/app/api/auth/google/callback/route.ts`, lines 39 and 68 redirect to
`new URL(..., url.origin)` where `url` comes from `request.url`. Behind a
TLS-terminating proxy that origin is whatever the proxy let through, so in the
probe it resolved to `https://localhost:4001` — the internal socket — instead of
the configured public origin. A failed sign-in in production would therefore
send the browser to an address that does not exist for the user.

It is not exploitable on its own: the transport check rejects a foreign `Host`
before the handler runs, so a forged origin cannot become an open redirect. It is
still wrong in the failure path, and `RASPBERRY_PUBLIC_ORIGIN` is already in scope
and already validated. Cheap to fix, worth fixing before any hosting returns.
