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

- **Tests:** 397 passing, 0 failing, across 31 test files.
- **Typecheck:** `tsc --noEmit` clean.
- **Committed through:** `b1a7c78` — docs: snapshot at the commit above.
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

## What is next — in this order

The database programme is numbered B38–B45. B38, B39 and all of B40a–B40h are shipped.
What follows is what the code does *not* yet have, verified against disk rather than
against a plan:

1. **Finish the property rail (B40).** `Change type` — nothing exists to fill in: there is
   only a comment where it goes (`property-header.tsx:239`) and a `<MenuHeading>` standing
   in for it. The server half does exist and is tested (`patchProperty` refuses a retype
   with `409 property_in_use`). Then property reorder (no route, no prop),
   filter-from-property-menu, multi-sort — the model supports a list and the read path
   handles one (`table-view.tsx:163`), but the write replaces the array with a single entry
   (`database-block.tsx:146`), so the UI can never produce more than one sort — and the
   `editing:{row,property}` keyboard model — Enter down, Tab right. None of that keyboard
   model exists yet.
2. **The trailing row (B41, one item).** `+ New page` is still a button after the table
   rather than a last `<tr>`. Cheapest real win on the board, and it unlocks type-to-create.
3. **Options and status (B42).** Today a Select/Status cell is a native `<select>`.
   Needs tag pills, option CRUD, create-on-the-fly, and editable status groups. This is
   the wishlist's one stated difference from Notion.
4. **Display semantics (B43).** `display: bar|ring` is declared in the type config and
   read by nothing. Same for `color` and `showNumber`. Also end-date and granularity UI.
5. **Formulas (B44).** Nothing exists beyond a config stub. Parser → AST → evaluator,
   cycle detection, errors as values. **Never `eval`** — this is a binding architecture
   rule, not a preference. Largest single unit remaining.
6. **Views (B45).** Blocked on the view registry: `src/components/database/views/` with
   `viewRenderers: Record<ViewType, ViewComponent>` does not exist, and the API has no
   `POST /views`. Registry first, then view CRUD, then Board, Calendar, List, Gallery.

Two prerequisites the plan implies that the code has not yet paid for: **the view
registry before B45**, and **the `readOnly`/`derived` guard below before cell writing
grows any further**.

**B21 (more Notion blocks) is waiting on the owner.** The instruction is explicit: the
owner supplies the block list, do not guess at it.

## Open risks — named because they are live code, not hypotheticals

These came out of reconciling the plans against the source, and are the things most
likely to bite:

- **`patchRow` does not honour `readOnly` or `derived`.** It calls `coerce` and stores
  the result for any property. `createdTime` is accidentally safe because its `coerce`
  refuses everything; `button` and `formula` are unguarded, and a formula cell write
  would store a number. No test covers a write to a derived property.
  (`src/server/databases.ts`, the `patchRow` path.)
- **Descending sort inverts "empties last".** `src/lib/database/rows.ts:88` negates the
  comparator (`descending ? -result : result`), so empties float to the top on a descending
  sort while every `compare` documents empties-last-in-both-directions. The fix belongs in
  `sortRows`, not in 16 `compare`s. Note the same file's `filtered`/`sorted` path at line
  158 is where the ordering reaches the UI.
- **Retyping is stricter than the plan.** The plan wanted coercion with a `409` only
  when coercion fails. The code refuses whenever any cell has a value, regardless. No UI
  calls it yet, so this is a decision waiting to be made rather than a bug.

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
