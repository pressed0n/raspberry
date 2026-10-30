# State of Raspberry

**This file is the only statement of what is done, what is next, and what is parked.**
If any other document disagrees with it, this file is right and that document is history.
`docs/ARCHIVE/` holds the old plans, preserved unedited.

The snapshot below is machine-checked: the test count, the migration range, the commit it
describes, and whether the working tree is clean. "Committed through" names the commit this
description was verified at, and it must be an **ancestor** of HEAD rather than equal to it —
the commit that updates this line changes HEAD, so an equality check could never converge.
If you change the suite, the check tells you to update this file; that is the mechanism that
keeps it from rotting the way its predecessors did.

---

## Snapshot

<!-- SNAPSHOT:BEGIN — checked by tests/docs-freshness.test.ts -->

- **Tests:** 415 passing, 0 failing, across 32 test files.
- **Typecheck:** `tsc --noEmit` clean.
- **Committed through:** `af5297c` — docs: snapshot at the commit above.
- **Schema:** migrations 1–7.
- **Working tree:** dirty (uncommitted work in progress).
<!-- SNAPSHOT:END -->

Run it yourself, it takes four seconds:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;" + $env:Path
node node_modules\typescript\bin\tsc --noEmit
node node_modules\tsx\dist\cli.mjs --test tests/*.test.ts
```

## What this is, and who for

A personal Notion clone for the owner's own notes. One user, one workspace, one machine,
loopback only. Not commercial, not competing with Notion, not a demo for anyone else.

Signed off by the owner on 28 October 2026 and worth not re-litigating:

- **One user.** Multi-user identity is a retrofit nobody has asked for. `B16` is parked.
- **Not hosted.** The hosting pilot was cancelled and its files deleted. It returns only
  as a new decision, never as resumption of an old plan.
- **"Raspberry Pi" is a name, not a deployment target.** The question is retired.

## What is built

Enough to be concrete without the 42 KB of narrative that used to be here (it is in
`docs/ARCHIVE/BACKLOG.md` if you want the story of any of it):

- **Shell** — sidebar tree with drag-to-reorder and drag-to-nest, page menu, favourites,
  trash with restore and purge, tab strip with keyboard shortcuts, breadcrumbs, settings
  dialog, theming from a data palette.
- **Editing** — BlockNote-based block editor, object selection and clipboard, media
  blocks, clipboard-image paste and drag-in, drafts with optimistic sync.
- **Auth** — Google OIDC plus an emailed one-time code as second factor, sessions,
  migration-versioned schema. Untested against a real mail provider by design; see parked.
- **Database** — schema, the 16-property registry, the pure query pipeline, CRUD over
  properties/views/rows/cells, a table view with gutter, row drag, duplicate, trash,
  column menus, icon pickers and hidden properties. **This is the live workfront.**

Shipped on 30 October 2026, after the last reconciliation, and each proved in a browser
(`scripts/run-b40-probe.ps1`: 15/15 at 1400×900, 9/9 at 390×844):

- **`Change type` (B40).** The property menu lists every type that can hold a value, and a
  change *converts* what it can read — `src/lib/database/convert.ts`, one rule: read the old
  cell through the new type's own `coerce`. Cells it cannot read are counted, the change is
  refused with that count in `error.details`, and the menu then offers the second, explicit
  answer (`Clear 2 cells and use Number`). Nothing is ever cleared without being counted out
  loud first.
- **Multi-sort.** Sorting a second column adds a key instead of replacing the first
  (`nextSorts` in `src/lib/database/rows.ts`, tested). The pipeline always accepted a list;
  only the UI could not produce one.
- **The trailing row (B41).** The last `<tr>` of the table is the `New page` row, built from
  the same gutter/name/icon-slot cells as a real row so it lands on the same pixels (520px
  measured at both widths). Typing a name and pressing Enter creates the page with that
  title; the row stays ready for the next one.
- **Keyboard.** Enter in a cell moves down the column, Arrow keys move without editing,
  Escape reverts (`src/lib/database/cell-nav.ts`). Tab is the browser's own, because every
  editable cell is a real field.

## What is next — in this order

The database programme is numbered B38–B45. B38, B39 and all of B40a–B40h are shipped.
What follows is what the code does *not* yet have, verified against disk rather than
against a plan:

1. **Finish the property rail (B40) — two items left.** `Change type`, multi-sort and the
   keyboard model shipped; what is still missing is **property reorder** (no route, no prop)
   and **filter-from-property-menu** (the read path filters, nothing writes a filter). Both
   need a UI decision before they need code — a filter bar is a new piece of chrome, and the
   reorder can be a menu item or a header drag, which are different gestures.
2. **Options and status (B42).** Today a Select/Status cell is a native `<select>`.
   Needs tag pills, option CRUD, create-on-the-fly, and editable status groups. This is
   the wishlist's one stated difference from Notion.
3. **Display semantics (B43).** `display: bar|ring` is declared in the type config and
   read by nothing. Same for `color` and `showNumber`. Also end-date and granularity UI.
4. **Formulas (B44).** Nothing exists beyond a config stub. Parser → AST → evaluator,
   cycle detection, errors as values. **Never `eval`** — this is a binding architecture
   rule, not a preference. Largest single unit remaining.
5. **Views (B45).** Blocked on the view registry: `src/components/database/views/` with
   `viewRenderers: Record<ViewType, ViewComponent>` does not exist, and the API has no
   `POST /views`. Registry first, then view CRUD, then Board, Calendar, List, Gallery.

The `readOnly`/`derived` guard that used to sit in this list as a prerequisite **is done**:
`patchRow` refuses a value written to a computed or self-setting property, per cell, with a
400 that names the property. Cell writing can grow now.

**B21 (more Notion blocks) is waiting on the owner.** The instruction is explicit: the
owner supplies the block list, do not guess at it.

## Open risks — named because they are live code, not hypotheticals

These came out of reconciling the plans against the source. Two were fixed on 30 October and
are kept here, with their tests named, because the *reason* they existed is the useful part:

- ~~**`patchRow` does not honour `readOnly` or `derived`.**~~ **Fixed.** The refusal is
  declared by each type module (`created-time.ts`, `button.ts`, `formula.ts` all say so in
  their own comments), so the write path now reads it: per cell, before any write, with a
  400 that names the property. `tests/database-writes.test.ts` covers a formula write, a
  `createdTime` write, and a mixed request that tries to smuggle a computed value in beside
  a writable one.
- ~~**Descending sort inverts "empties last".**~~ **Fixed.** Emptiness is now decided before
  the direction is applied, so `Z → A` keeps blank rows at the bottom, which is what every
  `compare` documents. `tests/database-columns.test.ts` pins it for a number column, a text
  column, and a two-key sort.
- **Retyping is now coercion with a counted refusal.** `patchProperty` converts what the new
  type can read and refuses the rest with `409 property_in_use` plus
  `details: { propertyId, cells, type }`; `clearUnconvertible: true` is the caller's answer.
  `src/lib/database/convert.ts` (one rule, an allow-list of text-reading targets) and
  `tests/database-type-change.test.ts` (9 tests).

## Parked — and the split is the point

The owner parked the whole former to-do list on one condition: nothing is worked on
until Raspberry runs somewhere reachable from other devices. But **most of these do not
actually need a server**, and the old `CHECKLIST.md` put all thirteen under "everything
here waits for an online server", which was wrong and would have kept them buried.

### Genuinely hosting-gated (7)

`B17` callback redirect origin (only manifests behind a TLS proxy) · `B6` remote MCP with
OAuth · `B7` email deliverability (SPF/DKIM/DMARC) · `B8` deployment runbook ·
`B5` session and account management UI (the service methods exist and are tested; no UI
reaches them) · `B4` Postgres adapter under the test suite · `B16` invites, multiple users.

### Parked by instruction, though local-only (6)

`B14` one Playwright smoke flow · `B10` attachments and uploads · `B11` real search
ranking (today: substring `LIKE`, 200-page cap) · `B12` retention and pruning ·
`B13` workspace export/import · `B15` accessibility and mobile audit.

Two notes worth keeping, because the reasoning has changed since they were parked:

- **B14's stated rationale is now false.** It was argued for because "nothing currently
  proves the app renders" — but the CDP harnesses in `scripts/scratch/` have since driven
  the real UI at 1400, 900 and 390 pixels many times over. There is still no *committed*
  smoke flow, which is the honest reason to want it.
- **B10's premise has partly landed.** Media blocks and clipboard images shipped with
  content-addressed storage in `src/server/files.ts`, so "no binary storage of any kind"
  is no longer true. B10 is now about limits, orphan cleanup and lifecycle.

## Known limitations, stated plainly

- One user, one workspace, loopback only. Not reachable from another machine.
- No live collaboration. Concurrent edits resolve by revision rejection (`409`).
- Write bodies capped at 1 MB; 2,000 blocks; ten nested block levels.
- The JSON validator only accepts block types the editor enables, so an unknown block
  fails loudly rather than being silently dropped. Intentional — but hand-edited
  documents can be refused.
- Search is case-insensitive substring matching, capped at 200 pages per listing.
- Sidebar tree does not autoscroll, so a drop target below the fold needs a manual scroll.
- Tab reordering is pointer-only; `Alt Shift ←/→` is the keyboard equivalent.
- The tab strip is empty in server-rendered HTML. No layout shift, but no SSR tabs.
- Nothing verified against a screen reader; mobile checked at 390px by automated probe.
- Authentication has never run against a real mail provider or a public origin.

## Explicitly cancelled

The third-party subdomain hosting pilot, the NikDTM hosting plan, and the cloud VPS
migration. **Do not resurrect without a new decision from the owner.**

## Where the history went

| File | What it is |
|---|---|
| `docs/ARCHIVE/BACKLOG.md` | The old 42 KB backlog. Its "Active to-do" section was 11/14 shipped work. Kept for the narrative of each item. |
| `docs/ARCHIVE/DATABASE_PLAN.md` | The B38–B45 plan v2 with per-phase reasoning and the risks section that predicted the two open risks above. |
| `docs/ARCHIVE/RASPBERRY_PLAN.md` | The original architecture research. Still binding on *constraints* (no `eval`, rows are pages, revision + idempotency); superseded on *roadmap* and on the proposed stack it never adopted. |
| `PLAN.md` (root) | Generated by the planning tool on each new plan. **Not truth** — it is overwritten. |

## How to answer "is this file still accurate?"

```powershell
node scripts/check-docs.mjs          # recomputes the snapshot, exits non-zero on drift
node scripts/check-docs.mjs --fix    # rewrites the snapshot block in place
```

The same check runs inside the suite as `tests/docs-freshness.test.ts`.
