# Where everything lives

Read this before grepping. It exists because every session re-derived the same answers —
"which file owns drag?", "where does the database live?", "which test is the pattern to
copy?" — and because the reuse rule in `AGENTS.md` is unenforceable if you cannot find the
component to reuse.

One rule for this file: **one line per thing, with the path.** A sentence with no path
belongs in `STATE.md` (what is true now) or `DECISIONS.md` (why it is like that).

Sections are ordered by what you need first, not by filesystem order.

---

## 1. Run it

```powershell
Start-Raspberry.cmd          # the only supported way on the owner's machine
# then http://127.0.0.1:3000  — dev server, hot reload, loopback only
```

`start_raspberry.cmd` finds Node itself: it prefers a vendored toolchain at
`.tools\node-v24.22.1-win-x64\`, and falls back to `%USERPROFILE%\.cache\codex-runtimes\…`.
**`.tools/` is gitignored**, so on a fresh clone that path does not exist and a documented
`$env:Path = "$PWD\.tools\…"` line is a lie. Either use the launcher, or use whatever
`node --version` already works for you (24+).

| Task | Command |
|---|---|
| Run the app | `Start-Raspberry.cmd` |
| Typecheck | `node node_modules\typescript\bin\tsc --noEmit` |
| Unit + integration suite | `node node_modules\tsx\dist\cli.mjs --test tests\*.test.ts` |
| Both, plus the drift gate | `node scripts\check-docs.mjs --full` — this is the one that prints the pass count |
| Docs/tests/scripts drift gate only | `node scripts\check-docs.mjs` (`--fix` repairs the snapshot) |
| Back up the live database | `node node_modules\tsx\dist\cli.mjs scripts\backup.ts` (also `pnpm backup`) |
| MCP stdio server | `node node_modules\tsx\dist\cli.mjs src/mcp/stdio.ts` |

`package.json` also has `pnpm dev`, `pnpm test`, `pnpm check` — the same commands, but pnpm is
not on PATH here, so the invocations above are the ones that work.

**Restart the launcher after adding a server method.** See §3.

---

## 2. Shape of the repo

| Path | What it is | Read it when |
|---|---|---|
| `src/` | The app. Next.js App Router + React 19. 139 files. | Always. |
| `tests/` | 39 test files + `schema.ts` helper. `tsx --test`. | Before and after any change. |
| `docs/` | `STATE.md` (truth), `MAP.md` (this), `DECISIONS.md` (why), `TESTING.md` (how to prove), `ARCHIVE/` (history). | First, in that order. |
| `scripts/` | 43 real tools, documented in §7. | To run or verify something. |
| `scripts/scratch/` | Gitignored one-off probes, incl. the `cdp-*.mjs` browser probes. Evidence, not tooling — no counts here, because the number changes every session. Import `scripts/browser-session.mjs` for new ones. | Only to read a past measurement. |
| `data/` | Gitignored. `raspberry.sqlite` is **the owner's live database**, plus `uploads/<sha>` blobs, `logs/`, `archive/`, and **`backups/`** — restore points, written by `pnpm backup`. | Never casually. §8. |
| `artifacts/` | Gitignored test evidence: screenshots and probe logs. **Never a database** — this folder is documented as disposable, so owner data in it is one `rd /s /q` from gone. Was 14.6 GB of leaked Chrome profiles — see §9. | Rarely. |
| `deploy/` | `raspberry.service` unit for running the built app as a Windows service via `scripts/install-service.ps1`. | Only for "run it as a service". |
| `prototype/` | Standalone HTML explorations. Not imported by the app, not built, not tested. | Only when the owner points at it. |
| `src/app/*.css` | Eight stylesheets, each with one owner. §5. | Any visual change. |
| `.tools/`, `.secrets/`, `.unjess/`, `.next/` | Gitignored: vendored Node, push credentials, agent harness state, build output. | Never commit. |

---

## 3. One request, end to end

This is the single most useful paragraph in the file. A page save, top to bottom:

| Step | File |
|---|---|
| The editor component owns the draft | `src/components/block-editor.tsx` |
| Draft persistence / debounce | `src/lib/draft-registry.ts`, `src/lib/draft-sync.ts`, `src/components/use-page-draft.ts` |
| Client fetch layer (the one exception to "lib is pure") | `src/lib/api-client.ts` |
| Route handler | `src/app/api/pages/[id]/route.ts` |
| HTTP plumbing, JSON, errors, auth gate | `src/server/http.ts`, `src/server/access.ts`, `src/server/local-access.ts` |
| Business logic (all of it) | `src/server/service.ts` |
| SQL | `src/server/database.ts` |
| Schema changes | `src/server/migrations.ts` — 7 migrations, numbered, append-only |
| Service instance lookup | `src/server/runtime.ts` |

Databases have their own layer on top of the same spine:
`src/server/databases.ts` (service) → `src/lib/database/properties.ts` (schema/edit rules) →
`src/lib/database/rows.ts` (cells, ordering, `sortRows`, `nextSorts`) →
`src/lib/database/convert.ts` (what a type change does to the values already there) →
`src/lib/database/cell-nav.ts` (Enter/arrows between rendered cells) →
`src/lib/database/property-types/<type>.ts` (one file per property type; `shared.ts` is the
common contract) → UI in `src/components/database/`.

### API surface — every route, and where a body's shape is defined

| Route (under `/api`) | Methods |
|---|---|
| `/pages` | GET, POST |
| `/pages/[id]` | GET, PATCH, DELETE |
| `/pages/[id]/history` | GET |
| `/pages/[id]/move` | POST |
| `/pages/[id]/purge` | DELETE |
| `/pages/[id]/restore` | POST |
| `/trash` | DELETE |
| `/databases` | POST |
| `/databases/[id]` | GET, PATCH |
| `/databases/[id]/properties` | POST |
| `/databases/[id]/properties/[propertyId]` | PATCH, DELETE |
| `/databases/[id]/rows` | POST |
| `/databases/[id]/rows/[rowId]` | PATCH, DELETE |
| `/databases/[id]/rows/[rowId]/duplicate` | POST |
| `/databases/[id]/rows/order` | POST |
| `/databases/[id]/views/[viewId]` | PATCH |
| `/files` | POST |
| `/files/[id]` | GET |
| `/health` | GET |
| `/auth/google/start`, `/auth/google/callback` | GET |
| `/auth/verify-code`, `/auth/resend`, `/auth/logout` | POST |

**Bodies are not validated at the route layer.** Every handler is three lines: `readBody`,
hand the object to one service method, wrap it in `api()`. So the shape of a body is defined
by the method that receives it — `addProperty`, `patchProperty`, `addRow`, `patchRow`,
`reorderRows`, `patchView`, `duplicateRow`, `patchDatabase` in `src/server/databases.ts` —
not by the route. Read the method; the route will tell you nothing.

Two absences are deliberate, not oversights: there is no `POST /views` (a database ships with
its views) and no `DELETE /views/[id]`, and there is no filter endpoint — filters are
client-side.

### Where the schema lives — two files, and a trap in each

| Tables | Defined in |
|---|---|
| `schema_migrations`, `users`, `workspaces`, `memberships`, `pages`, `revisions`, `mutations` — the baseline | `src/server/database.ts` |
| `accounts`, `sessions`, `login_challenges`, `auth_events` | `migrations.ts`, migration 3 |
| `files` | migration 5 |
| `databases`, `database_properties`, `database_views`, `database_cells` | migrations 6–7 |

The baseline is in `database.ts`, not in `migrations.ts`, so "grep migrations for the table"
misses every table the page editor actually uses. A new table is a new numbered migration;
the baseline is never edited.

**There is no `blocks` table.** A page's blocks are JSON in `pages.content` (with a flattened
copy in `plain_text` for search, and `revision` incremented on write). Two consequences worth
knowing before you touch page writes:

- **Nesting is stored twice** — `pages.parent_id` (what the sidebar draws) and a `pageLink`
  block appended to the *parent's* content (what the parent's page shows). Writing one and not
  the other is how a nested page "disappears". This has shipped as a bug once.
- **Purging and restoring are recursive** over `parent_id`, not over content. See
  `src/server/service.ts` and `tests/purge.test.ts`.

### The 500 that is not a bug

`src/server/runtime.ts` parks the database handle and the two service wrappers on **`globalThis`** —
deliberately, so they outlive a hot reload. Only the handle is unkeyed. The wrappers are tagged with
the class that built them (`reused`), so a reload that replaces a class also replaces its instance:
a method or a schema you added a minute ago is live on the next request.

Two things still need `Start-Raspberry.cmd` restarted: **a migration** (it runs when the connection
opens) and a change to `openDatabase` itself. If a *new method* answers `is not a function`, or a
validator rejects a value it should accept, that is now a real bug rather than the old staleness —
`DECISIONS.md` § "A memo on `globalThis` must remember what built it" has the history.

---

## 4. Reuse before you write

`AGENTS.md` rule 2, and `tests/frame-anchor.test.ts` enforces the grip half of it. Search
here first; if the control you need is one of these, import it.

| Control | Import from | Use for | Trap |
|---|---|---|---|
| Grip + plus pair | `src/components/frame-anchor.tsx` renders `FrameAnchor`; it renders `GripButton` and `AddGlyph` internally | The 6-dot grip and the plus, together, **always plus before grip** | **Never import `GripGlyph` directly.** `frame-anchor.test.ts` pins the dots to `grip-glyphs.tsx` alone. A database row grip is a `FrameAnchor`, not a `GripGlyph`. |
| A grip on its **own**, with no plus | `GripButton` from `src/components/grip-glyphs.tsx` | A drag handle inside a row that is not an object on a page — the tag menu's reorder grip is the only one so far | `extraClass` adds a **modifier** *alongside* `.frame-grip`, never instead of it — that is how `.db-grip` already works. `.db-option-grip` overrides geometry only (16×20, 13×16 glyph, `pointer-events: none` until revealed, and its own `(hover: none)` lift). A host that replaced the base class loses the shared transition, the hover lift and touch visibility. Pass `tabIndex={-1}`: a drag handle is not a menu item and must not become an unlabelled tab stop in front of every row. |
| The bare glyphs | `src/components/grip-glyphs.tsx` | Definitions only (`GripGlyph`, `AddGlyph`, `GripButton`) | Four importers are permitted and pinned by `frame-anchor.test.ts`: `frame-anchor.tsx` (the pair), `database/add-property-menu.tsx` (`+ Add property` — plus and label, no grip), `database/option-panel.tsx` (a lone `GripButton`) and `database/group-controls.tsx` (`AddGlyph` for a group's `+` and `+ New group`). A fifth fails the suite by design. `database/status-groups.tsx` used to be the fourth and is now not one — the row moved into `group-controls.tsx` so both surfaces render one control. |
| Drag preview / drop indicator | `src/components/drag-layer.tsx` | Anything dragged: pages, blocks, rows | One layer for the whole app; do not position a second one. |
| Modal shell, focus trap, Esc | `src/components/modal.tsx`; richer dialog `src/components/editor/dialog.tsx`, `src/components/settings/dialog.tsx` | Any dialog | Use the one whose layer you are in; do not fork a third. |
| Menu positioned at a point or button | `src/components/database/menu.tsx` with placement maths in `src/lib/menu-place.ts` | `⋯` menus, context menus, submenus | Placement is a shared calculation — right-click and `⋯` use the same one. A submenu is closed **positionally, not by `mouseleave`**: its surface sits 6px off the row, and that strip belongs to neither box, so crossing it fires the row's leave and unmounts the surface before the pointer arrives. While open, the surface closes on the first pointer move that is on neither its row, its surface, nor the strip between them. Do not go back to a leave handler, and do not "fix" it with a close timer — a timer shows two submenus at once when the pointer moves to a sibling row, and `scripts/verify-db-submenu-hover.mjs` asserts both directions. Its row opens on `click` without toggling, because a tap fires `mouseenter` and `click` and a toggle would shut the surface the tap just opened. |
| A menu that must close | `useMenuDismiss(open, onClose)` in `src/components/database/menu.tsx` | **Every** `MenuSurface` caller, without exception | `MenuSurface` *places* a surface and does nothing else: it registers neither the outside-press listener nor the Escape one, so a menu rendered without `useMenuDismiss` can only be closed by its own trigger. This is not a subtlety — the tag panel shipped without it, so pressing anywhere on the page did nothing, the panel stayed open, and the next click landed on the surface instead of the cell behind it. `tests/database-options.test.ts` fails the suite if the tag panel loses it. **And it returns early on a press inside *any* `[data-db-popover]`, so it can never close a sibling submenu** — pressing the tag menu's second row `⋯` is inside the first panel's popover, so per-row "editing" state left two colour panels open and the second press looked dead. One submenu open at a time has to be state the *parent* owns. |
| A side submenu's height | `menuStyle(…, side: "right")` in `src/components/database/menu.tsx` | Any `side="right"` surface | The panel is capped to the room that is actually left below its row and scrolls inside itself; a flat 120px reserve put the tag colour list's lower half **177px below the fold** on a 1378×802 viewport, and a point outside the viewport hits `null`, so those colours could not be clicked at all. A requested 1440×900 window is a **1378×802** viewport — measure with `innerHeight`, never the size you asked Chrome for. |
| A menu row's right-hand sample ("1,234") | `.db-menu-value` — rendered by `MenuItem`'s `trailing` and `MenuSub`'s `trailing` | Number format / decimal place samples, currency symbols | One class, so the value and the tick stay in fixed columns. Do not render a bare text node after the label; it sits under the words. A label plus a sample has to fit 200px: "Number with separators" is 149px, so formats carry no sample — the parent row reports the current rendering instead. |
| Sort wording and arrow | `sortLabels(type)` and `sortKind(type)` in `src/lib/database/properties.ts` | Any control that names a sort direction | **Never write "A → Z" in a view.** It is a claim about the type's comparison and it is false for numbers, dates and checkboxes; a column of numbers sorted ascending is "Low → High" and its header arrow is `ArrowUpNarrowWide`, not `ArrowUpAZ`. A tag column has a **third** order — `manual`, the sequence a person arranged — and `sortLabels` grows a `manual` label only when the type implements `PropertyTypeSpec.order`; render that row from the label's presence, never from the type name, and `sortRows` falls back to `compare` for a type that has none. |
| A submenu a diagonal reaches | `inSafeTriangle` + module-scoped `activeSub` in `src/components/database/menu.tsx` | Any `MenuSub` | The corridor above only covers a *horizontal* crossing. A hand reaching the second item travels right **and down**, leaves the row's band while still inside the parent, and the surface vanished — every item below the first. The triangle from the pointer's last position on the row to the surface's near edge is safe, gated on the direction of travel so a hand heading away still closes (that is what keeps "hovering a plain row closes it" true). Because a triangle can overlap a neighbouring row, sibling exchange is `activeSub`: the row that opens last closes the one before it in the same event. Do not re-add a close timer, and do not delete the direction test. |
| Page glyph / entry icon | `src/components/page-glyph.tsx`, `src/components/database/entry-icon.tsx` | Page and database icons | Do not reach for `lucide-react`. |
| Property type icons | `src/components/database/property-icons.tsx` | Any property-type icon | Driven by generated palette data; see `scripts/gen-palette.mjs`. |
| Colour palette / swatches | `src/lib/palette.ts`, `src/components/database/icon-picker.tsx` | Colour and icon pickers | Palette is generated; regenerate, do not hand-edit. |
| Tag chips + tag colour list | `src/components/database/option-panel.tsx` | Anything that renders a Select / Multi-select / Status value | The chip's colours are `COLOR_NAMES` from `palette.ts` plus `default` (the same ten names `tagColors` validates); the colour list is the shared `.swatch` control, sized down. Its name clips for the ellipsis, so `.db-tag-name` declares its own `line-height` — do **not** let it inherit `/ 1` from `.db-tag`, which sliced 1.5px off every descender (B42b, measured by `scripts/verify-text-clip.mjs`) |
| Status group sections + the group tick | `src/lib/database/property-types/groups.ts` for the reading, `src/components/database/group-controls.tsx` for the **one** editor, `option-panel.tsx` and `status-groups.tsx` to mount it | Anything that draws or edits a Status column's groups | **Read through `groupsOf`, never `config.groups`.** An empty array means the three defaults, and a `groupId` that names nothing means the first group — a column that has never been edited stores `[]`, so reading the raw field draws zero sections. `storedGroups` is the *write* side and is deliberately a different function: opening the editor must not migrate the owner's data. The row, its `+`, its expandable panel and `New group` live in `group-controls.tsx` and **both** surfaces render them — the dropdown with `variant="option"` (heading-sized, count hidden, `+` revealed on hover) and the property menu with the default. Never draw a second row that only looks like one: that is exactly how "there's a + on the group" became "there isn't", because it was built in one place and described in the words of the other. The tick before a status chip is the shared `.db-check` box as an inert `<span>` (`aria-checked`, `aria-hidden`, `pointer-events: none`) — it is a label on the group, so never make it a button, and never make it the source of truth for "done". Creating a tag with the group `+` from the **dropdown** does two writes and they are ordered: the option must exist in the config before the cell points at it, or `coerce` empties the cell (measured — it lost the race at 1400px and won it at 390px). Deleting a group deletes its tags and `patchProperty` prunes the cells in the same transaction; a status config write must carry **both** `options` and `groups`, because the server validates the whole object. |
| Form controls (toggle, field, row) | `src/components/settings/controls.tsx` | Settings and any settings-shaped form | These are small and easy to redraw by accident. |
| Page picker / move destination | `src/components/page-picker.tsx`, `src/components/move-picker.tsx` | Choosing a parent page | Both already handle cycles and self-move. |
| Object selection & clipboard | `src/components/editor/object-selection.tsx`, `src/lib/page-copy.ts` | Selecting/copying non-text objects | Copy is serialised through `page-copy.ts`, not the system clipboard alone. |

### `FrameAnchor` — the contract, because you cannot place a row grip without it

```ts
type FrameAnchorProps = {
  onAdd: () => void;              // required — a pair without it is the one object you
  addLabel: string;               //           cannot add below
  addTest?: string;
  onGrip?: () => void;            // press of the grip; omit when the grip is a drag handle
  gripLabel: string;
  gripTest?: string;
  gripOpen?: boolean;             // drives aria-expanded and the is-open tick
  gripClass?: string;             // `db-grip` for a drag handle, `is-inert` when it cannot act
  gripPointer?: GripPointerHandlers;  // { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  inline?: boolean;               // host lays the pair out (row gutter) instead of floating
  anchorRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
};
```

Floating (default) is the editor's side menu: `.frame-anchor` positions itself on the block's
left edge. `inline` is the database row: the host positions it, so the pair can hang in the
page margin *outside* the table's own box — that is the 39×30 pair at 19.5+19.5, plus then
grip. A drag source passes `gripPointer` and `gripClass="db-grip"` rather than `onGrip`;
`scripts/verify-db-gutter.mjs` asserts all of it in a real browser.

---

## 5. Where to edit

### App shell and styling

| File | Owns |
|---|---|
| `src/app/layout.tsx` | Root layout, fonts, providers |
| `src/app/page.tsx` | The single page that mounts the shell |
| `src/app/globals.css` | Reset, tokens, typography |
| `src/app/shell.css` | Sidebar + main shell geometry |
| `src/app/tabs.css` | Tab strip |
| `src/app/settings.css` | Settings window |
| `src/app/database.css` | Database block, table, gutter, cells |
| `src/app/document.css` | Document column (`.doc`), page content measure |
| `src/app/editor-blocks.css` | Block types inside the editor |
| `src/app/theme.css` | Theme variables |
| `src/lib/theme.ts` | Theme selection and persistence |

A CSS rule for a component belongs in the sheet that owns that component's area, not in
`globals.css`. The gutter/table alignment bug (`STATE.md`) came from one sheet overriding
another's width — check specificity and which sheet loads last before blaming the component.

### Components

| File | Role |
|---|---|
| `src/components/workspace.tsx` | Top-level client shell: sidebar, document, state |
| `src/components/block-editor.tsx` | The editor itself (largest component) |
| `src/components/use-page-draft.ts` | Draft hook used by the editor |
| `src/components/tab-strip.tsx` | Open-page tabs |
| `src/components/crumbs.tsx` | Breadcrumb trail |
| `src/components/page-menu.tsx` | Page context menu (also right-click) |
| `src/components/page-picker.tsx` | Page chooser |
| `src/components/move-picker.tsx` | Move-to destination chooser |
| `src/components/page-glyph.tsx` | Page icon glyph |
| `src/components/sign-in.tsx` | Hosted-mode sign-in UI |

The shared controls — `frame-anchor.tsx`, `grip-glyphs.tsx`, `group-controls.tsx`, `drag-layer.tsx`,
`modal.tsx` — also live here but are documented in §4, where the traps are.

`src/components/editor/`

| File | Role |
|---|---|
| `object-menu.tsx` | Block/object `⋯` menu |
| `object-selection.tsx` | Selecting non-text objects |
| `dialog.tsx` | Editor-layer dialog |
| `media.ts` | Media block helpers |
| `media-video.tsx` | Video embed block |
| `paste-images.ts` | Image paste handling |
| `schema.tsx` | Block schema/capabilities |
| `selection.ts` | Selection model helpers |

`src/components/database/`

| File | Role |
|---|---|
| `database-block.tsx` | The database block: owns view state, sorts, calls the API |
| `table-view.tsx` | Table rendering, row/cell layout, gutter alignment |
| `property-header.tsx` | Column header, property menu, `Change type` slot |
| `cell-editor.tsx` | Per-type cell editing |
| `option-panel.tsx` | Select / Multi-select / Status as tag chips + the option menu (§4) |
| `date-panel.tsx` | **Date**: the cell trigger and the picker — two bounds, the six-week calendar, the clock fields, `End date` / `Include time`. One implementation, and the only place a date value is written (§4) |
| `group-controls.tsx` | **The only** group editor: the row (name, count, `+`), its expandable panel (Rename / Displays as checked / Add a tag / Delete group) and `New group`. Rendered by the tag dropdown *and* the property menu (§4) |
| `status-groups.tsx` | The property menu's shell around that editor — back arrow, title, the list (§4) |
| `add-property-menu.tsx` | New-property menu |
| `menu.tsx` | Menu primitive + placement (§4) |
| `property-icons.tsx` | Property-type icons (§4) |
| `icon-picker.tsx` | Icon + colour picker |
| `entry-icon.tsx` | Row/page icon in the database |
| `use-database.ts` | Data-fetching hook for a database |

`src/components/settings/`

| File | Role |
|---|---|
| `nav.tsx` | Settings window navigation |
| `controls.tsx` | Shared form controls (§4) |
| `dialog.tsx` | Settings dialog |
| `preview.tsx` | Live preview pane |

### Logic — `src/lib/` (pure, unit-tested)

`api-client.ts` (fetch layer — the documented exception), `document.ts` (document model),
`page-changes.ts` (diffing a draft against saved), `page-copy.ts` (copy/paste serialisation),
`crumbs.ts`, `tabs.ts`, `draft-registry.ts`, `draft-sync.ts`, `sidebar-drag.ts` (page tree
drag maths), `sidebar-menu.ts`, `menu-place.ts` (menu positioning), `palette.ts`,
`theme.ts`, `settings.ts`, `settings-nav.ts`, `clipboard-image.ts`.

`src/lib/database/`: `properties.ts`, `rows.ts`, `types.ts`, `calendar.ts`, `property-types/*`.
`calendar.ts` is the date picker's arithmetic — the fixed six-week grid, the loose time parser,
the stepper and `orderBounds` — and it is the only place that turns a day into a string.
`property-types/groups.ts` is the status-group reading (defaults, which group a tag belongs to,
the checked lookup, the prune) — see §4. `property-types/option-ids.ts` is the tag id scheme and
the tag colour list; it lives below the components because both the option panel **and** the
group editor need them, and a component module may not import the one that imports it.

### Server — `src/server/`

| File | Role |
|---|---|
| `service.ts` | All page/document business logic |
| `database.ts` | SQLite access, queries |
| `migrations.ts` | 7 append-only migrations |
| `runtime.ts` | Memoised service instance (§3) |
| `http.ts` | Request/response helpers, error shape |
| `access.ts`, `local-access.ts` | Who may do what; loopback single-user gate |
| `databases.ts` | Database/property/row service |
| `files.ts` | Upload/download of `data/uploads/<sha>` |
| `backup.ts` | Database backup |
| `session.ts`, `rate-limit.ts` | Sessions, request limits |
| `auth/` | `config`, `google`, `login`, `challenges`, `cookies`, `events`, `limits`, `mail`, `session-store`, `tokens` |

`src/mcp/`: `server.ts` (the MCP tool implementation), `stdio.ts` (stdio entry).

---

## 6. Tests — 35 files, and which one to copy

| Group | Files | Copy this one |
|---|---|---|
| Pages and documents | `pages`, `blocks`, `move`, `purge`, `positions`, `page-changes`, `drafts`, `crumbs`, `tabs` | `tests/pages.test.ts` |
| Service + SQLite integration | `service`, `databases`, `database-columns`, `database-properties`, `database-writes`, `migrations`, `files`, `access` | `tests/database-writes.test.ts` |
| Auth | `auth-login`, `session-store` | `tests/auth-login.test.ts` |
| Pure helpers | `sidebar-drag`, `sidebar-menu`, `menu-place`, `palette`, `settings-nav`, `clipboard-image`, `client` | `tests/sidebar-drag.test.ts` |
| Browser/UI primitives | `frame-anchor`, `media-blocks` | `tests/frame-anchor.test.ts` |
| MCP | `mcp`, `stdio` | `tests/mcp.test.ts` |
| **Guards on agents themselves** | `docs-freshness` (STATE/MAP/counts/artifacts), `frame-anchor` (reuse rule) | — |

`tests/schema.ts` is a helper, not a test. Guard tests are the two worth reading before you
argue with them: they exist because a note was ignored and a rule was re-broken.

Pixel-level UI verification is **not** in the suite. It is CDP probes; see `docs/TESTING.md`
and use `scripts/browser-session.mjs` so the browser profile cleans itself up.

---

## 7. Scripts — 42 tools

| File | Does |
|---|---|
| `scripts/local.mjs` | Dev/preview launcher behind `Start-Raspberry.cmd` (`pnpm dev`, `pnpm preview`) |
| `scripts/serve.mjs` | Production server (`pnpm start`) |
| `scripts/backup.ts` | Copies the live database to a timestamped backup (`pnpm backup`) |
| `scripts/check-docs.mjs` | The drift gate: STATE snapshot, counts, MAP coverage, root-markdown allowlist, artifacts leak, git facts |
| `scripts/check-icons.mjs` | Verifies property/icon references resolve |
| `scripts/gen-palette.mjs` | Regenerates the colour palette data used by `src/lib/palette.ts` |
| `scripts/browser-session.mjs` | **Tracked CDP browser session** for UI verification; removes its own Chrome profile |
| `scripts/verify-db-gutter.mjs` | The canonical row-gutter probe (20 assertions, 1400/390): alignment, reuse-by-pixel, heights |
| `scripts/verify-db-topstrip.mjs` | Proves the band around a database block is inert (7 assertions, 1400/390): every pixel above and below it is pressed with real input and must neither select the block nor move the caret, while the title and a column header still work. Read-only |
| `scripts/verify-db-th-state.mjs` | Proves the property header's two states (15 assertions, 1400/390, read-only): the label holds no `<svg>` beyond its property icon and sort arrow, so the removed chevron cannot come back under another class; and the fill while its menu is open outlives the pointer and is **brighter** than hover. Compares composited luminance against the nearest opaque ancestor, because both tokens are translucent — comparing the computed strings would compare alpha, not brightness |
| `scripts/verify-live-write-guard.mjs` | Proves the live-write guard **is installed and refusing**: a GET succeeds on :3000, a POST is rejected before it leaves the browser, and the page count is unchanged before/after. Run after touching `browser-session.mjs` |
| `scripts/verify-live-validators.mjs` | Asks the **running** server, not a copy, which sort directions its validator knows — because a process that predates a schema change answers with the old enum and no probe can see it. Sends `direction: "sideways"`, invalid in every version, which `patchView` rejects before its `UPDATE`, so it writes nothing and the error message is the whole measurement. Exits non-zero if the list is missing a direction or if the view's config moved |
| `scripts/verify-database-b40.mjs` | Proves the table's write gestures **without writing**: patches `window.fetch` in the page, asserts the bodies the UI builds, and can let one real `PATCH` through on a disposable instance (`ALLOW_WRITES=1`, the 409 and the "Clear 2 cells" answer) |
| `scripts/seed-qa.mjs` | Seeds a disposable instance (`BASE` env, default :3100) with one page holding one database: a title column, a text column, three rows. Used by `run-b40-probe.ps1`. Never points at `data/raspberry.sqlite` |
| `scripts/run-b40-probe.ps1` | Starts a disposable copy of the app on :3100 from `artifacts/qa-run/`, seeds it, runs `verify-database-b40.mjs` at 1400×900 and 390×844, stops it. The owner's database is never touched |
| `scripts/verify-db-number.mjs` | Proves the Number column's menu with a real pointer on a **disposable** instance: the sort is worded Low → High, the format submenu lists every format and twelve currencies, a click that crosses the 6px gap into the submenu's portal changes the cell, decimal places survive a format change (the config merge), and no label in any surface is ellipsised. 22 assertions, 1400/390 |
| `scripts/seed-qa-number.mjs` | Seeds a disposable instance (`BASE` env, default :3100) with a page holding one database whose second column is a **Number**: `Name` + `Amount`, three rows (1234.5, 7, 0.25). Used by `run-number-probe.ps1`. Never points at `data/raspberry.sqlite` |
| `scripts/run-number-probe.ps1` | Starts a disposable copy of the app on :3100 from `artifacts/qa-run/`, seeds it with `seed-qa-number.mjs`, runs `verify-db-number.mjs` at 1400×900 and 390×844, stops it and deletes the copy |
| `scripts/verify-db-submenu-hover.mjs` | Proves a submenu survives being *reached* (9 assertions, read-only): a pointer that dwells in the 6px gap, crosses it a pixel at a time, crosses back, or arrives diagonally must not lose the surface; a sibling row still swaps submenus instead of showing two; a plain row still closes it |
| `scripts/run-submenu-hover-probe.ps1` | Starts a disposable copy of the app on :3100 from `artifacts/qa-run/`, seeds it with `seed-qa-number.mjs`, runs `verify-db-submenu-hover.mjs` at 1400×900 and 640×844 — the second width is where the submenu flips to the **left** of its row, a different gap in a different direction |
| `scripts/read-spec-page.mjs` | Reads one spec page out of the running app |
| `scripts/verify-local.ps1` | Local smoke verification |
| `scripts/seed-qa-tags.mjs` | Seeds a disposable instance (`BASE` env, default :3100) with a page holding one database whose columns are `Name`, a **select** (`Alpha` orange, `Beta` purple) and an empty **multiSelect**, two rows. Used by `run-tags-probe.ps1`. Never points at `data/raspberry.sqlite` |
| `scripts/verify-db-tags.mjs` | Proves the tag menu with a real pointer on a **disposable** instance: no cell is a native `<select>`, picking a tag stores the option **id**, clicking the chosen tag clears the cell, **creating** one writes it to the property's config *and* leaves the cell holding it, recolouring writes the option (and repaints the chip), multi-select keeps both tags, deleting an option clears the cell that pointed at it. 17 assertions, 1400/390 |
| `scripts/verify-text-clip.mjs` | Does any element lose text at the bottom of its box? Walks every element that clips (`overflow: hidden`/`clip`) and owns text, and compares that string's **ink** against the padding box using canvas font metrics — `fontBoundingBox*` for the line box, `actualBoundingBox*` for the ink — so descenders are measured, not eyeballed. Read-only on the live app (`PAGE=<page id>`, or `BASE=` a disposable copy). Reports how many elements it examined, so "nothing clipped" cannot be an empty sweep. Found the chip cutting 1.5px off g, j, p, q, y |
| `scripts/seed-qa-reorder.mjs` | Seeds a disposable instance with one page, one database, one row and a **select** holding four options in a deliberately non-alphabetical order (`Gamma, Alpha, Delta, Beta`) — with two options, "moved down one" and "swapped" are the same array, so a wrong splice reads as a pass. Used by `run-reorder-probe.ps1` |
| `scripts/verify-db-option-reorder.mjs` | Proves the tag menu's reorder grip with a real pointer on a **disposable** instance: every row has the shared grip left of its chip, it is invisible and unclickable at rest, hovering the row reveals it **without shifting the chip**, a press that never moves reorders nothing, the drop line appears on the row under the pointer, a drag down lands *after* the target and a drag up *before* it, the order survives a reload, `⋯` → Move up/down moves exactly one place and is disabled at the ends, and a filtered list draws no grips. Every claim read back from the stored config, not the DOM. 25 assertions, 1400/390 |
| `scripts/run-reorder-probe.ps1` | Starts a disposable copy on :3101 from `artifacts/qa-run-reorder/`, runs the reorder probe at 1400×900 and 390×844 **with a fresh seed per resolution**, stops it and deletes the copy |
| `scripts/seed-qa-sort.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name` and a **select** (`Gamma, Alpha, Delta, Beta`) and five rows — **arranged order, alphabetical order and seeded row order are all different**, and one row holds no tag, because a fixture whose arrangement happens to be alphabetical passes with either comparator wired in. Used by `run-sort-probe.ps1` |
| `scripts/verify-db-sort-order.mjs` | Proves the Sort submenu of a Select column with a real pointer on a **disposable** instance: `Manual order` leads the submenu and only for types with an arrangement, **`A → Z` is the tag's name** while Manual order is the dropdown's sequence, the untagged row is last in both, the header names and marks the sort that is actually running, the tick follows, and a **diagonal** move to a lower row does not close the submenu. Every claim read back from the stored view config, not the DOM. 21 assertions, 1400/390 |
| `scripts/run-sort-probe.ps1` | Starts a disposable copy on :3102 from `artifacts/qa-run-sort/`, runs the sort probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe sets three different sorts on one view, so a shared seed lets the second pass read the first pass's leftovers), stops it and deletes the copy |
| `scripts/seed-qa-groups.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name` and a **Status** — with **no stored groups at all** and every tag's `groupId` null, which is exactly what the owner's live column holds. A fixture that already had groups would never exercise the materialisation. Used by `run-groups-probe.ps1` |
| `scripts/verify-db-status-groups.mjs` | Proves the status groups with a real pointer on a **disposable** instance: a column that has never had groups written draws To do / In progress / Complete **and opening it writes nothing**, the pane lists them with counts inside the *same* surface, `Displays as checked` stores the three groups it drew (plus the tags), the tick reaches a cell that was never rewritten, a new group can be created checked-or-not and filled from its own `+`, the dropdown then draws four headings in the pane's order, an unchecked group's chip draws an empty box, one press on Delete deletes nothing and the second removes the group, its tag **and the cell that pointed at it**, and a rename keeps the group's id. Section 9 then runs the owner's four sentences against the **tag dropdown** — `+` on every group, one press on a name expands the same four actions, `New group` is there, `+` on an empty group stores a tag *in that group* (config written before the cell, or `coerce` empties it), and Delete from the dropdown takes the group, its tag and the cell. Every claim read back from `/api/databases/:id`. 44 assertions, 1400/390 |
| `scripts/run-groups-probe.ps1` | Starts a disposable copy on :3103 from `artifacts/qa-run-groups/`, runs the groups probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe deletes a group and renames another), stops it and deletes the copy |
| `scripts/run-groups-shot.ps1` | The same disposable copy, photographed instead of asserted: opens the Status header's menu and the Status-groups pane and saves `artifacts/shots/groups-pane-<width>.png` **plus** `-menu.png` of the menu itself at both widths, then prints the pane's text in DOM order. It claims nothing and writes nothing — it exists because "does this look made on purpose" is not a question an assertion can answer. `scripts/scratch/crop.mjs` then enlarges a 28px control 3× so the answer is visible |
| `scripts/shot-groups-pane.mjs` | The photographing half of `run-groups-shot.ps1`, tracked because that script calls it: opens the Status header's menu, then the Status-groups pane, saves `<name>.png` and `<name>-menu.png`, and prints the pane's text in DOM order so the shot has a caption. Claims nothing, writes nothing |
| `scripts/seed-qa-dates.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name` and a **Date** (`format: long`, no clocks) and four rows, one of which is seeded with a date so the *rendering* of a stored value is exercised as well as the writing of a new one. Used by `run-dates-probe.ps1` |
| `scripts/verify-db-dates.mjs` | Proves the date picker with a real pointer on a **disposable** instance: the cell opens one `dialog` surface whose grid has six weeks, `Today` writes the local day, the picker stays open and `Escape` closes it with the write intact, `End date` adds a second bound and the *pen* moves to it, the next press becomes the end **and both bounds are ordered on the server**, the same day twice is still one day, `Include time` stores `includeTime` on the *property* and draws a clock per bound, the two clocks are stored as `T09:00`/`T17:00`, a range inside one day says the date **once**, `Clear` empties the cell on the server, the header's `Date format` row carries the current sample and choosing `Day/month/year` stores `format: dmy` and re-renders the cell, and the whole panel is inside the viewport. Every claim read back from `/api/databases/:id`. 34 assertions, 1400/390 |
| `scripts/run-dates-probe.ps1` | Starts a disposable copy on :3104 from `artifacts/qa-run-dates/`, runs the date probe at 1400×900 and 390×844 **with a fresh seed per resolution**, then runs `verify-text-clip.mjs` on the same page (the date cell's trigger clips for its ellipsis — the shape that cut a descender off a tag chip), stops it and deletes the copy |
| `scripts/run-tags-probe.ps1` | Starts a disposable copy of the app on :3100 from `artifacts/qa-run/`, runs `verify-db-tags.mjs` at 1400×900 and 390×844 **with a fresh seed per resolution** (sharing one seed made the second pass read the first pass's tags), stops it and deletes the copy |
| `scripts/verify-session.ps1` | Session/auth verification |
| `scripts/install-service.ps1` | Installs `deploy/raspberry.service` |
| `scripts/uninstall-service.ps1` | Removes it |

One-off probes live in `scripts/scratch/` (gitignored). A file named `cdp-*`, `probe-*` or
`tmp-*` in `scripts/` itself fails `check-docs.mjs`.

---

## 8. Data

| Path | What |
|---|---|
| `data/raspberry.sqlite` | **The owner's live database.** One user's real pages. |
| `data/uploads/<sha>` | Live attachments, content-addressed. Not disposable. |
| `data/logs/` | Server and dev logs. |
| `data/archive/` | Dead databases moved aside, not deleted. |

Hard rule, twice over: **never delete, trash, or "tidy" pages in the live database.** Not
as cleanup after a test, not because they look like fixtures or say "Untitled". Full rule and
the safe read-only procedure: `docs/TESTING.md`. If a test must write, delete only the exact
ids it created in that same run.

---

## 9. Hazards

- **Do not recurse the repo root** if you can scope it. `node_modules/` is ~40 k files; a
  bare `Get-ChildItem -Recurse` from the root took **15 s** after cleanup and **timed out at
  120 s** before it. Scope to `src`, `tests`, `docs`.
- **`artifacts/` was a 14.6 GB, 371 607-file hole** (292 leaked Chrome profiles from CDP
  probes) and `.gitignore` hid it from every check. It is now 182 files / 43 MB.
  `scripts/check-docs.mjs` fails if a `.chrome-*` profile reappears; use
  `scripts/browser-session.mjs`, which deletes its profile on exit.
- **A 500 right after you edited a service class** is the stale instance, not your code. §3.
- **`docs/STATE.md` is the only truth about state.** If this file disagrees with it about
  what is done, STATE wins; if this file disagrees about *where things are*, they have both
  rotted — run `node scripts\check-docs.mjs`.



