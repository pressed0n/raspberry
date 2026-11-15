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
| `src/` | The app. Next.js App Router + React 19. 172 files. | Always. |
| `tests/` | 49 test files + `schema.ts` helper. `tsx --test`. | Before and after any change. |
| `docs/` | `STATE.md` (truth), `MAP.md` (this), `DECISIONS.md` (why), `TESTING.md` (how to prove), `ARCHIVE/` (history). | First, in that order. |
| `scripts/` | 62 real tools, documented in §7. | To run or verify something. |
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
`src/lib/database/formula/` (the expression language: `tokenize` → `parse` → `evaluate`, the
function registry in `functions/`, and the editor's `catalog`/`paint`/`suggest`/`trace` beside it —
**never `eval`**) →
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
| A side submenu's height | `menuStyle(…, side: "right")` in `src/components/database/menu.tsx` | Any `side="right"` surface | The panel is capped to the room that is actually left below its row and scrolls inside itself; a flat 120px reserve put the tag colour list's lower half **177px below the fold** on a 1378×802 viewport, and a point outside the viewport hits `null`, so those colours could not be clicked at all. A requested 1440×900 window is a **1378×802** viewport — measure with `innerHeight`, never the size you asked Chrome for. A caller that also states `preferHeight` gets the other exit: the surface **hangs from the row's bottom edge** and grows upward instead of scrolling, which is what the picker's nine-row format list needed (164px of window was drawing five of them). |
| A menu row's right-hand sample ("1,234") | `.db-menu-value` — rendered by `MenuItem`'s `trailing` and `MenuSub`'s `trailing` | Number format / decimal place samples, currency symbols, and the **name** of the running date format | One class, so the value and the tick stay in fixed columns. Do not render a bare text node after the label; it sits under the words. A label plus a sample has to fit 200px: "Number with separators" is 149px, so the number formats carry no sample — the parent row reports the current rendering instead. The date row reports the format's *name* (`Full date`), not a rendering: a sample there ("October 27, 2026") was the widest thing in the property menu and is what pinned it at 268px. |
| The width of a dropdown | `MENU_WIDTH` (252) and `SUBMENU_WIDTH` (200) in `src/components/database/menu.tsx` | Every `MenuSurface` | **Do not pass a width that is not one of those two**, and do not write one in `database.css` — `MenuSurface` sets it inline, so a stylesheet rule is a second opinion that always loses. The family used to be four numbers in three files (240 in CSS under a 268 inline, 272 for the tag dropdown, 296 for the calendar), which is how a *cell* menu ended up the widest box in the app. 252 is also a floor, not a target: "Date format" + "Year/Month/Day" + a caret is ~230px of that, and `verify-db-dates.mjs` fails if any menu row truncates its own name. |
| A pane (a surface whose body is **replaced**) | `MenuPaneHead` in `src/components/database/menu.tsx`, with the body in its own component | `Status groups` in the property menu — and **nothing else since B43d**: `Date format` in the date picker is a fly-out now | Replacing the body is the last resort, not a default. It shipped once for the picker's format list on the argument that a second surface beside a 252px one has nowhere to go at 390px, and the owner sent it back: *"those options should open next to the dropdown."* So a "more" row flies out (`MenuSub`) unless the thing behind it is genuinely a *place*. A pane carries `caret` (the same chevron a fly-out wears, because the gesture is the same promise) and keeps the surface's own `useMenuDismiss`. **Two things the head does for you and a hand-rolled one forgets:** `.db-prop-icon-btn` + the `.db-menu-back` modifier — geometry kept, chrome dropped, so `←` and a row's `+` read as siblings — and `autoFocus`, because opening a pane removes the row that had focus, so `document.activeElement` falls to `<body>`, which is *outside* the surface, where `onMenuKeys` never hears another press. Coming back needs `focusMenuRow(key)` on a row that carries `focusKey={key}`. `tests/database-status-groups.test.ts` fails if the pane draws its own head or loses the way back in; `tests/database-dates.test.ts` fails if the picker grows either half, because a fly-out never takes the focused row away. |
| A submenu with no room below it | `MenuSub`'s `preferHeight` → the `side: "right"` branch of `menuStyle` | The date picker's `Date format` fly-out (260). No other submenu passes one | A side submenu normally tracks its row's top edge and clamps its height to the window, which is right for a list that scrolls by design. The picker's `Date format` row is the last row of a ~370px panel, so at 1400×900 that gave it **164px** and five of its nine rows — both clocks under a fold. A caller that states `preferHeight` instead hangs the surface from the row's **bottom** edge and grows upward. Opt-in only: every other submenu's placement is measured by a probe, and changing them all would be a redesign wearing a fix's clothes. |
| The six `Date format` rows and the two clocks | `DateFormatRows` / `TimeFormatRows` in `src/components/database/date-format-rows.tsx` | Any surface offering a date format | One list, two surfaces (the property menu's submenu and the picker's fly-out), for the same reason the group row has one implementation. Both take an `onPick` and neither decides what a pick *does*: the header closes its menu, the picker keeps its fly-out open, because the person is mid-value. A pick writes `onConfig({ format })` — the **property's** config, so the whole column changes — never `onCommit`, which would change one row's reading and leave the column disagreeing with itself. |
| Sort wording and arrow | `sortLabels(type)` and `sortKind(type)` in `src/lib/database/properties.ts` | Any control that names a sort direction | **Never write "A → Z" in a view.** It is a claim about the type's comparison and it is false for numbers, dates and checkboxes; a column of numbers sorted ascending is "Low → High" and its header arrow is `ArrowUpNarrowWide`, not `ArrowUpAZ`. A tag column has a **third** order — `manual`, the sequence a person arranged — and `sortLabels` grows a `manual` label only when the type implements `PropertyTypeSpec.order`; render that row from the label's presence, never from the type name, and `sortRows` falls back to `compare` for a type that has none. |
| A submenu a diagonal reaches | `inSafeTriangle` + module-scoped `activeSub` in `src/components/database/menu.tsx` | Any `MenuSub` | The corridor above only covers a *horizontal* crossing. A hand reaching the second item travels right **and down**, leaves the row's band while still inside the parent, and the surface vanished — every item below the first. The triangle from the pointer's last position on the row to the surface's near edge is safe, gated on the direction of travel so a hand heading away still closes (that is what keeps "hovering a plain row closes it" true). Because a triangle can overlap a neighbouring row, sibling exchange is `activeSub`: the row that opens last closes the one before it in the same event. Do not re-add a close timer, and do not delete the direction test. |
| Page glyph / entry icon | `src/components/page-glyph.tsx`, `src/components/database/entry-icon.tsx` | Page and database icons | Do not reach for `lucide-react`. |
| Property type icons | `src/components/database/property-icons.tsx` | Any property-type icon | Driven by generated palette data; see `scripts/gen-palette.mjs`. |
| Colour palette / swatches | `src/lib/palette.ts`, `src/components/database/icon-picker.tsx` | Colour and icon pickers | Palette is generated; regenerate, do not hand-edit. |
| Tag chips + tag colour list | `src/components/database/option-panel.tsx` | Anything that renders a Select / Multi-select / Status value | The chip's colours are `COLOR_NAMES` from `palette.ts` plus `default` (the same ten names `tagColors` validates); the colour list is the shared `.swatch` control, sized down. Its name clips for the ellipsis, so `.db-tag-name` declares its own `line-height` — do **not** let it inherit `/ 1` from `.db-tag`, which sliced 1.5px off every descender (B42b, measured by `scripts/verify-text-clip.mjs`) |
| Status group sections + the group tick | `src/lib/database/property-types/groups.ts` for the reading, `src/components/database/group-controls.tsx` for the **one** editor, `option-panel.tsx` and `status-groups.tsx` to mount it | Anything that draws or edits a Status column's groups | **Read through `groupsOf`, never `config.groups`.** An empty array means the three defaults, and a `groupId` that names nothing means the first group — a column that has never been edited stores `[]`, so reading the raw field draws zero sections. `storedGroups` is the *write* side and is deliberately a different function: opening the editor must not migrate the owner's data. The row, its `+`, its expandable panel and `New group` live in `group-controls.tsx` and **both** surfaces render them — the dropdown with `variant="option"` (heading-sized, count hidden, `+` revealed on hover) and the property menu with the default. Never draw a second row that only looks like one: that is exactly how "there's a + on the group" became "there isn't", because it was built in one place and described in the words of the other. The tick before a status chip is the shared `.db-check` box as an inert `<span>` (`aria-checked`, `aria-hidden`, `pointer-events: none`) — it is a label on the group, so never make it a button, and never make it the source of truth for "done". Creating a tag with the group `+` from the **dropdown** does two writes and they are ordered: the option must exist in the config before the cell points at it, or `coerce` empties the cell (measured — it lost the race at 1400px and won it at 390px). Deleting a group deletes its tags and `patchProperty` prunes the cells in the same transaction; a status config write must carry **both** `options` and `groups`, because the server validates the whole object. |
| A checkbox that is a **value** in a cell | `.db-check` (the box) + `.db-check-cell` (its wrapper) in `src/app/database.css`, rendered by `CellEditor` | Any boolean cell | The box must never be a direct child of the `<td>`. A `<td>` here is `vertical-align: top`, and an inline-level box in it is placed by the **text baseline** — which for an `inline-grid` is the baseline of its *contents*, so the same control drew 2.5px lower once ticked (an empty grid's baseline is its bottom edge; a ticked one's is the `✓`'s). `.db-check-cell` is a flex row with `height: 100%`, which blockifies the box (no baseline can reach it) and centres it in the cell's content box at any row height. The inset lives there, not on the box: a `margin-left` on `.db-check` moves the gutter's select box too, and a `vertical-align` on it aligns a box against a baseline it must not be part of. `tests/database-checkbox.test.ts` pins both; `verify-db-checkbox.mjs` measures the three states and fails if the tick moves when it is pressed. |
| A checkbox that is a **label** on a status group | `.db-check` as an inert `<span>` — see the status row above | The tick drawn before a chip | Not the same job as a value: `aria-hidden`, `pointer-events: none`, and never the source of truth for "done". |
| The way into a page **from a table row** | `.db-open`, a named button inside `.db-name-cell`, rendered by `table-view.tsx` | Every row of every view | **One route, and it is a button.** The `<tr>` carries no press handler at all, and `.db-row` sets no `cursor: pointer`: a handler on the row sees every cell's presses and cannot tell a rename from a double press meant to select a word, which is how a double press used to navigate away mid-edit and take the half-typed value with it (the owner: *"i should only be able to open up the page by clicking the designated open button which we already have"*). The button is inert — `pointer-events: none`, `opacity: 0` — until the row is hovered or something inside it has focus, so an invisible button cannot be pressed by accident. Do not wire a cell, a name or a double press to `onOpenRow`: `tests/database-row-open.test.ts` counts the calls and `scripts/verify-db-row-open.mjs` presses every one of those places. |
| The way into a **link** from a URL cell | `UrlOpen` in `src/components/database/url-cell.tsx`, rendered by `CellEditor`'s url branch inside `.db-url-cell` | Any URL cell | **The same rule as the row's `Open`, one level down.** The field keeps the press — that is how a caret gets into it, and every other column does the same on that press — and the address opens from a `↗` mark drawn by `.db-open`'s own reveal rule: `opacity: 0` and `pointer-events: none` until the row is hovered or something in it has focus. It is a real `<a href>` (so the status bar shows the address, ⌘-click and the middle button work, and `target=_blank` keeps a half-written table on screen), and `href` is the **committed** value, never the draft. A press on the mark must not blur the field, or the blur commits a half-typed address on the way to opening the old one. Read-only tables render the text as the link instead (`UrlText`), because there is no field to compete with. `tests/database-url.test.ts` pins the anchor's attributes and the inert rest state; `scripts/verify-db-url.mjs` presses both the words and the mark with a real pointer. |
| A **cell that is a button** — press it, a surface opens | `.db-tag-trigger`, `.db-date-trigger`, `.db-files-trigger` — one selector list in `src/app/database.css` | Select / Multi-select / Status, Date, Files & Media | The shared half is the **box**: full width, no chrome of its own, the cell's own font, left aligned, `cursor: pointer`, and focus drawn *inside* (`outline-offset: -2px`, or the ring overlaps the next column and reads as that column's focus). Each column keeps only what differs — a tag cell wraps its chips and is `min-height`, a date cell is one fixed 32px line, a files cell has a tile in it. Do not restate the box in a fourth rule: `tests/database-files.test.ts` fails if `.db-files-trigger` does. The press is `onMouseDown` toggling, not `onClick`: `useMenuDismiss`'s document listener runs on capture and closes the surface first, so a `click` toggle reopens it and the surface looks stuck open. Pass the anchor as `useMenuDismiss`'s third argument when the trigger is a real toggle. A keyboard press fires `click` with `detail === 0`, which is the only way in for a cell with no field. |
| A **small named button** — a short verb in a box | `.db-mini-btn` in `src/app/database.css` | The error banner's `Retry`, the file panel's `Upload` | Neither a glyph well (`.db-prop-icon-btn`) nor a menu row: those are icons and commands, this is a word. It was `.db-retry` until it had a second caller; `tests/database-files.test.ts` fails if `.db-retry` comes back. |
| **An upload field in a cell** — Files & Media | `FilesCell` / `FilesSummary` / `FilesText` in `src/components/database/files-cell.tsx`, the value helpers in `src/lib/database/property-types/files.ts` | Any Files & Media cell | The cell is a **button**, never a text field: a typed name stored a reference to bytes nobody uploaded. Read the value through **`fileList`** and spell the URL through **`fileHref`** — the cell must not write `/api/files/…` itself, or the read-only table and the cell can disagree. Upload through `editor/media.ts`'s `uploadFile`, the app's one uploader; do not add a second `fetch`. A batch commits **once**, after the last file lands, from a ref and not from `value` — a mid-batch render carries the pre-batch list, and committing that silently drops the file before it. A refused upload names the file and the server's sentence and **does not abort the batch**. Removing a file removes the **reference**; nothing in this app deletes a blob, because the store is content-addressed and another cell may hold the same bytes. |
| **A column that computes itself** — Formula | `FormulaCell` in `src/components/database/formula-cell.tsx`, the language in `src/lib/database/formula/`, `applyFormulas` on the server's read path | Any Formula cell, and anything that reads a row | A formula has **no field**: the expression is the property's *config*, so the cell writes through `onConfig` and never through `onCommit`, and the write path refuses a value for the column. The computed value is put in `row.cells[id]` **on read**, so the table, the sorts, the filters, the groups and the MCP export read it like any other cell — do not add a second path that recomputes. Never `eval`/`new Function` the expression. An **empty** input makes the result empty (`prop("Price") * 2` on a row with no price is blank); a wrong *type* is an error sentence. The function list, the docs and the examples all come from the registry in `functions/` — adding a function is one entry there, never a second list, and its examples are executed by `tests/database-formula.test.ts` |
| A **search that answers into a cell** — the Place column | `src/components/database/place-cell.tsx` (the field, the listbox, the states), `src/lib/database/property-types/place.ts` (the stored shapes and the GeoJSON mapper), `src/server/places.ts` (the only outbound request in the app), `src/app/api/places/search/route.ts` | Any Place cell, and the map view that will read `placeCoordinates` | **The field is the search box.** Press → caret → a `MenuSurface` with `role="listbox"` hangs off the field and the focus never leaves it, so the arrows walk the results (`aria-activedescendant`), `Enter` takes the highlighted row, the first `Escape` dismisses the list and the second gives the cell back its value. It is a `combobox`, not a menu: `role="listitem"`s would be announced as a list of commands. `onClick` opens as well as `onFocus`, because after a pick the caret is already in the field and the next press fires no `focus` event. `useMenuDismiss`'s third argument is the anchor, so a press inside the field is not an outside press. The value has two shapes — a bare string (typed) and a record with `lat`/`lng` (picked) — and the record means *this place has a point*; a record without one is coerced back to the string, so a filter, a cell and a map cannot disagree. Never let the request be per-keystroke: 380ms of quiet, two characters minimum, a memo on the client and a ten-minute cache on the server. Every state that is not a result still offers `Use "…"`, because this column was freeform text before it was a search engine. **The provider's order is not the answer's order** — `placeResults` scores every row on how well it answers the query (folded name bands, a house number that agrees or disagrees, the country the best credible row is in) and takes its bold line from whichever field matched, so `Grahovo Brdo 1` heads with the address and puts the farm on the dim line. An address-shaped query is asked **twice** (`providerQueries`: as typed, and without the trailing number), because Photon satisfies the number and lets the name go fuzzy. Do not re-introduce a per-keystroke request path: a free service cut this machine off after twenty rapid ones, so there is a retry-once on 5xx, a circuit breaker after three failures, and `503 places_busy` kept distinct from `502 places_unavailable`. The provider is Photon, not Nominatim, whose usage policy forbids auto-complete; `RASPBERRY_PLACES_URL` moves it, and `off` disables it. **A typed house number is never dropped:** when no result carries it, `composedHits` makes the address that was typed the row and anchors it to a road — roads only, and the settlement most of that name's roads are in — and the row carries `approx` because the point is the road's, not the door's. `approx` is stored (`PlaceValue.approx`) and survives `coerce`, so `placeReading(value).approximate` can tell a map marker apart from a real door. A landmark can never host a composed number: "Eiffel Tower 1" is not an address. `tests/database-place.test.ts` pins the shapes and the mapper, `tests/database-place-ranking.test.ts` the ranking, the composition and the server's manners; `scripts/verify-db-places.mjs` runs the whole path against a loopback fixture. |
| **A preview that follows the pointer** | `useFilePeek` + `FilePeek` in `src/components/database/file-peek.tsx`, arithmetic in `src/lib/peek-place.ts` | A row whose file is an image, and the tile of a closed cell | **Not a menu, so not `menu-place.ts`.** A menu is anchored to the trigger it acts on; a peek is *beside* the row and must never cover it, so it is placed right, flips left only when the right would leave the screen, and is centred then clamped vertically — no pointer offset at all, or it twitches as the mouse moves within the row. It must be portalled (the panel clips and scrolls), `pointer-events: none` (a box under the pointer that could be hit takes the `mouseleave` and blinks), and `aria-hidden` (the row already names the file). **One rule for "is this a picture":** `isImageFile`, which covers SVG because `image/svg+xml` starts with `image/` — a second list here is how the tile and the peek drift apart. Save a file through `fileDownloadHref`, never an `<a download>` alone: the store's `Content-Disposition` is the rule, the attribute is a hint. |
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
| `date-panel.tsx` | **Date**: the cell trigger and the picker — two bounds, the six-week calendar, the clock fields, `End date` / `Include time` / `Date format`, the last as a fly-out from the same `MenuSub` every submenu uses. One implementation, and the only place a date value is written (§4) |
| `date-format-rows.tsx` | **The only** six `Date format` rows and the two clock rows. Rendered by the property menu's submenu *and* the picker's fly-out — a second copy of this list is how one surface grows a seventh format and the other stays at six (§4) |
| `group-controls.tsx` | **The only** group editor: the row (name, count, `+`), its expandable panel (Rename / Displays as checked / Add a tag / Delete group) and `New group`. Rendered by the tag dropdown *and* the property menu (§4) |
| `status-groups.tsx` | The property menu's shell around that editor — back arrow, title, the list (§4) |
| `add-property-menu.tsx` | New-property menu |
| `menu.tsx` | Menu primitive + placement (§4) |
| `property-icons.tsx` | Property-type icons (§4) |
| `icon-picker.tsx` | Icon + colour picker |
| `entry-icon.tsx` | Row/page icon in the database |
| `url-cell.tsx` | **URL**: `UrlOpen` (the `↗` mark that opens a link, revealed by the row's own hover rule) and `UrlText` (the read-only link). The cell's *field* never navigates — a press in it puts a caret (§4) |
| `files-cell.tsx` | **Files & Media**: `FilesCell` — the cell is a button (`FilesSummary`: one 22px tile, the first name, `+N`), and the surface lists every attachment with its size, a link to its bytes, a save (`↓`, `fileDownloadHref`) and a `×`. `Upload` opens the OS picker, dropping files on the cell or the panel is the second way in, and a batch is **one cell write** committed after the last file lands, with the refused ones named in the surface. `FilesText` is the read-only table's version. Reuses `editor/media.ts`'s `uploadFile` — the app's one uploader — and never deletes a blob (§4, §7) |
| `formula-cell.tsx` | **Formula**: `FormulaCell` — the value is a button (the *fourth* caller of the shared cell-as-button box, so `.db-formula-trigger` is in that selector list), and it has **no field**: the expression is the property's config, so the write goes through `onConfig`, not `onCommit`. A column with no expression says `Add formula`; a row whose formula could not be evaluated prints `⚠ <sentence>` in the error colour, because a column of quiet sentences is a column people learn to ignore. `Empty` when the expression produced nothing. The read-only branch is a plain span (§4) |
| `formula-panel.tsx` | **The formula editor**: a 620px `MenuSurface` in four bands — the field, the preview, the list, the detail. The field is a `<textarea>` over a painted `<pre>` with *identical* metrics (any of font, padding, line-height or wrapping drifting by a pixel puts the caret a letter away from its word); colour and the "which word is the caret in" maths come from `lib/database/formula/paint.ts` and `suggest.ts`, both pure. The list is a suggestion list filtered by the token before the caret, narrowed **only after the first keystroke** (opening on an existing formula must not filter by its last token), and `Enter`/`Tab` insert at the caret with `add()`'s caret inside the brackets. The preview strip evaluates against a page you choose; debug mode swaps the browser for `traceFormula`'s tree. One write, on close |
| `file-peek.tsx` | The **hover preview of a file**: `useFilePeek` (300ms after a rest, cleared on leave, on blur and when the panel closes) and `FilePeek` (portalled to the body, fixed 268×224, `pointer-events: none`, `aria-hidden`). Placement is `placePeek` in `lib/peek-place.ts` — right of the row, flipping left when the right would leave the screen. Mounted at **both** call sites: a row in the open panel, and the 22px tile of a closed cell. Only images, decided by `isImageFile` — see §4 |
| `place-cell.tsx` | **Place**: the field *is* the search box. Opens a `role="listbox"` `MenuSurface` on press, debounces **380ms**, walks results with the arrows while the caret stays put, and offers `Use "…"` in every state that is not a result (§4). When the typed house number is in no row, the rows are that address composed onto the road it would be on, and the note underneath says so. **A cell that already holds a point opens as a card instead** — `placeCard()` in `property-types/place.ts` decides which — with the address, a `×`, and `<PlaceMap>` under it; typing over it brings the list back |
| `place-map.tsx` | The four OpenStreetMap squares inside that card, positioned by `tileGrid`, with the pin at the coordinate the value stores, the attribution, and a link out — **to Google Maps, as `maps/search/?api=1&query=lat,lng`**: the coordinate, never the address text, so the tab it opens shows the point the pin was drawn on (`mapLink` in `lib/geo/mercator.ts`). Its squares come from **`/api/places/tile`**, never from a tile server directly — see §7 and `src/server/tiles.ts` |
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
drag maths), `sidebar-menu.ts`, `menu-place.ts` (menu positioning), `peek-place.ts` (hover
preview positioning), `palette.ts`, `theme.ts`, `settings.ts`, `settings-nav.ts`,
`clipboard-image.ts`.

`src/lib/database/`: `properties.ts`, `rows.ts`, `types.ts`, `calendar.ts`, `property-types/*`.
`calendar.ts` is the date picker's arithmetic — the fixed six-week grid, the loose time parser,
the stepper, `orderBounds` and `dayDiff` — and it is the only place that turns a day into a
string. `property-types/date.ts` is the date *vocabulary*: six format names, the two retired
ones they replaced (`iso`, `long`), and `relativeLabel`, which takes "today" as an argument so
the one format whose answer depends on the clock can still be tested.
`property-types/groups.ts` is the status-group reading (defaults, which group a tag belongs to,
the checked lookup, the prune) — see §4. `property-types/option-ids.ts` is the tag id scheme and
the tag colour list; it lives below the components because both the option panel **and** the
group editor need them, and a component module may not import the one that imports it.

`src/lib/geo/` is the map arithmetic and only that: `mercator.ts` (the Web Mercator projection,
`tileGrid` — which squares cover a box, at integer offsets — `isValidTile`, `tileUrl`/`tileSrc`,
`mapLink` — the way out of a card, as a coordinate rather than an address) and `preview.ts` (the
preview's *policy*: how big its box is, and the two zooms — 16 for a
picked door, 15 for a road). No React, no fetches. The database's future map view imports the
arithmetic and writes its own policy; a second copy of the projection is how two maps end up
disagreeing about where the same place is.

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
| `places.ts` | **The app's first outbound request.** Photon (or `RASPBERRY_PLACES_URL`), a ten-minute `globalThis` cache, `PlaceServiceError`, and `off`. Server-side on purpose: the browser would send the owner's IP, every half-typed address and a user-agent we do not control to a third party |
| `tiles.ts` | **The second, and it is an image fetch.** One 256px square from `RASPBERRY_TILES_URL` (OpenStreetMap by default, `off` to switch the map off), a byte-budgeted `globalThis` cache with a stale copy served instead of a hole, a content-type check because a 200 carrying an HTML throttle page is not a tile, and **no retry** — a view is four squares and a missing one is a square, not a lost answer |
| `files.ts` | Upload/download of `data/uploads/<sha>` |
| `backup.ts` | Database backup |
| `session.ts`, `rate-limit.ts` | Sessions, request limits |
| `auth/` | `config`, `google`, `login`, `challenges`, `cookies`, `events`, `limits`, `mail`, `session-store`, `tokens` |

`src/mcp/`: `server.ts` (the MCP tool implementation), `stdio.ts` (stdio entry).

---

## 6. Tests — 48 files, and which one to copy

| Group | Files | Copy this one |
|---|---|---|
| Pages and documents | `pages`, `blocks`, `move`, `purge`, `positions`, `page-changes`, `drafts`, `crumbs`, `tabs` | `tests/pages.test.ts` |
| Service + SQLite integration | `service`, `databases`, `database-columns`, `database-properties`, `database-writes`, `migrations`, `files`, `access` | `tests/database-writes.test.ts` |
| Auth | `auth-login`, `session-store` | `tests/auth-login.test.ts` |
| Pure helpers | `sidebar-drag`, `sidebar-menu`, `menu-place`, `peek-place`, `palette`, `settings-nav`, `clipboard-image`, `client`, `geo-mercator` | `tests/sidebar-drag.test.ts` |
| Browser/UI primitives | `frame-anchor`, `media-blocks`, `database-checkbox` | `tests/frame-anchor.test.ts` |
| Database columns | `database-place`, `database-place-tiles`, `database-place-ranking`, `database-url`, `database-row-open`, `database-dates`, `database-options`, `database-status-groups` | `tests/database-place.test.ts` |
| MCP | `mcp`, `stdio` | `tests/mcp.test.ts` |
| **Guards on agents themselves** | `docs-freshness` (STATE/MAP/counts/artifacts), `frame-anchor` (reuse rule) | — |

`tests/schema.ts` is a helper, not a test. Guard tests are the two worth reading before you
argue with them: they exist because a note was ignored and a rule was re-broken.

Pixel-level UI verification is **not** in the suite. It is CDP probes; see `docs/TESTING.md`
and use `scripts/browser-session.mjs` so the browser profile cleans itself up.

---

## 7. Scripts — 56 tools

| File | Does |
|---|---|
| `scripts/local.mjs` | Dev/preview launcher behind `Start-Raspberry.cmd` (`pnpm dev`, `pnpm preview`) |
| `scripts/serve.mjs` | Production server (`pnpm start`) |
| `scripts/backup.ts` | Copies the live database to a timestamped backup (`pnpm backup`) |
| `scripts/check-docs.mjs` | The drift gate: STATE snapshot, counts, MAP coverage, root-markdown allowlist, artifacts leak, git facts |
| `scripts/check-icons.mjs` | Verifies property/icon references resolve |
| `scripts/gen-palette.mjs` | Regenerates the colour palette data used by `src/lib/palette.ts` |
| `scripts/browser-session.mjs` | **Tracked CDP browser session** for UI verification; removes its own Chrome profile. Carries `b.pixel(x, y)` — the composited colour at a viewport point, from a 1×1 screenshot — for questions computed style cannot answer, like "is this box opaque" |
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
| `scripts/seed-qa-dates.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name`, a **Date** (`format: full`, no clocks) and a **Select** with one tag, and four rows, one of which is seeded with a date and that tag so the *rendering* of a stored value is exercised as well as the writing of a new one. The Select column is there for `verify-text-clip.mjs`, which asserts the tag chip by name and cannot run on a page without one. A Select cell holds **one id, not a list** — writing a list is coerced to nothing, which is how the first version of this seed produced a page with no chip. Used by `run-dates-probe.ps1` |
| `scripts/verify-db-dates.mjs` | Proves the date picker with a real pointer on a **disposable** instance: the cell opens one `dialog` surface whose grid has six weeks, `Today` writes the local day, the picker stays open and `Escape` closes it with the write intact, `End date` adds a second bound and the *pen* moves to it, the next press becomes the end **and both bounds are ordered on the server**, the same day twice is still one day, `Include time` stores `includeTime` on the *property* and draws a clock per bound, the two clocks are stored as `T09:00`/`T17:00`, a range inside one day says the date **once**, `Clear` empties the cell on the server, the header's `Date format` row names the format in use, **all six formats** are chosen in turn and each stores its own value *and* re-renders the cell (`Relative` is asserted on a cell holding today, so the probe cannot start failing on a date nobody chose), the picker's **own** `Date format` row opens a **fly-out beside it** — two surfaces, the calendar still drawn, covering none of the row at 1400 and flipped inside the viewport at 390, with **zero pixels of scroll** inside it — lists the six plus `Time format`, ticks exactly what is in use, stores a clock and a format picked there with the tick following in the same surface, changes a row it never opened — the "whole column" half of the ask — and keeps the keyboard (`focus` opens the list, focus stays on the row, `ArrowDown` still reaches the picker's rows, one `Escape` closes both), every menu and the picker measure **252px**, no menu row ellipsises its own name, and the whole panel is inside the viewport. Every claim read back from `/api/databases/:id`. 77 assertions, 1400/390 |
| `scripts/run-dates-probe.ps1` | Starts a disposable copy on :3104 from `artifacts/qa-run-dates/`, runs the date probe at 1400×900 and 390×844 **with a fresh seed per resolution**, then runs `verify-text-clip.mjs` on the same page (the date cell's trigger clips for its ellipsis, and the page title's line box is the other box that clips — both are on this fixture), stops it and deletes the copy |
| `scripts/seed-qa-checkbox.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name`, a **Checkbox** and a **text** column, and **three rows in the three states a checkbox actually has**: `true`, `false` and the untouched `null` a person has never clicked. Two rows would not be enough — the owner's complaint was that two of them sat on different pixels. Used by `run-checkbox-probe.ps1` |
| `scripts/verify-db-checkbox.mjs` | Proves the checkbox cell with a real pointer on a **disposable** instance: all three states draw a 15×15 box, `aria-checked` follows the value, each box has **equal space above and below it** and sits on the cell's **centre line** (measured against the cell's *content* box, because a 32px row with a 1px border has 31px of inside), **a ticked box and an unticked box sit on the same pixel**, the left inset equals the padding every other column's text uses, pressing the tick stores `true` then `false` on the server (**not** `null`, which is the untouched state) and **moves the box by no pixels either time**, all three still share one offset after the writes, the row's own select box in the gutter did not move, and the tick is pressable once the table is scrolled to it at 390. 21 assertions, 1400/390 |
| `scripts/run-checkbox-probe.ps1` | Starts a disposable copy on :3105 from `artifacts/qa-run-checkbox/`, runs the checkbox probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe presses a tick, so a shared seed would let the second pass read the first pass's leftovers), stops it and deletes the copy |
| `scripts/verify-db-row-open.mjs` | Proves a row opens from its `Open` button and **nowhere else**, with a real pointer on a **disposable** instance: the row wears no pointer cursor; a double press **inside a text cell** leaves the address bar where it was, the table drawn and the half-typed value intact; a double press on the row's **name** does not open it; a double press on a **value tick** does not open it; a `dblclick` dispatched straight at the row opens nothing; and the `Open` button is inert while invisible and opens the row's own page once hovered and pressed. 18 assertions, 1400/390. Every press is `b.doubleMouse`, which counts the second press as the second — two `b.mouse` calls fire no `dblclick` at all |
| `scripts/run-row-open-probe.ps1` | Starts a disposable copy on :3106, runs the row-open probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe ends on a row's own page), stops it and deletes the copy. **`-Before` rebuilds the copy as the tree was before B46** — the `<tr onDoubleClick>`, the `db-row-open` class, the `cursor: pointer` rule — and fails the run if the probe passes there, so the probe has been shown to bite rather than assumed to |
| `scripts/seed-qa-url.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name` and a **URL**, and three rows: a pasted `https://www.example.com/docs`, a plain `http://127.0.0.1:3107/api/health` (the scheme is the point, and it is the opener the probe presses, so the page it opens is served by the copy rather than the internet), and an **empty** cell, which must offer nothing to open. One row would only prove the shortening on the string it was written against. Used by `run-url-probe.ps1` |
| `scripts/verify-db-url.mjs` | Proves the URL cell with a real pointer on a **disposable** instance: the cell reads `example.com/docs` while `/api/databases` still holds `https://www.example.com/docs`; the shortened form **fits its column** (117px of ink in 159px of field, measured with a canvas in the field's own computed font — `scrollWidth` on an `<input>` equals `clientWidth` whatever the value, so that check would have passed on anything); a cell with a link has an opener and the **empty one does not**; the opener is invisible **and untakeable at rest**, is a real `<a href>` pointing at the stored address with its own `title`, `target=_blank` and `rel=noopener noreferrer`, sits on the cell's **centre line** 4px from its right edge; hovering the row reveals it; a **double press on the words** leaves the page and the caret alone; **pressing the mark opens the address as a new page target** at the browser's debugging port while this page stays exactly where it was and the caret stays in the field; a typed `newsite.test` is stored as `https://newsite.test/` and read back bare; and the property menu's `Show full URL` row exists **once**, is off, says what off means, writes `fullUrl` to the **column's** config with every cell byte-identical, flips the cell to the full address as the tick moves in the surface that stayed open, and flips it back. §2b puts a saturated patch behind **each opener** — the URL mark and the row's `Open` chip, which had the same bug — and samples three interior pixels with the patch and without: **0/255** difference now, **217/255** on the pre-fix tree. That is the only way to see a `background` shorthand that replaced an opaque fill with a 7% wash: `getComputedStyle` reports the transparency quite happily. 30 assertions, 1400/390 |
| `scripts/run-url-probe.ps1` | Starts a disposable copy on :3107, runs the URL probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe rewrites a cell and toggles a column setting), stops it and deletes the copy. **`-Before` rebuilds the copy as it was before B48** — `format` returning the address as stored, `.db-url-open` always visible and always clickable, and **both openers' `background: var(--hover-strong)` hover** — and fails the run if the probe passes there |
| `scripts/seed-qa-places.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name` and a **Place**, and seven rows: a **typed** address (a bare string, no point), a **picked** place (the record shape, written *through the API* so the server's own `coerce` is part of the fixture), and five **empty** cells — one to search from, two so the "nothing is lost when the search cannot answer" checks do not start from a cell a previous section already wrote to, and two so the two ranking searches (`Village`, `Address`) are different questions in different cells. Every one of them exists because a shared cell would make "what got stored" a question about two writes instead of one. Used by `run-places-probe.ps1` |
| `scripts/verify-db-places.mjs` | Proves the Place cell with a real pointer on a **disposable** instance, against a **fixture geocoder it starts itself on loopback** (so no keystroke leaves the machine and the answers are deterministic): a typed address and a picked place both read as **one line** (never JSON); an empty cell says `Search a place…`; pressing a cell opens a surface **and the caret stays in it**; that surface is the shared **252px `listbox`** whose `id` the field's `aria-controls` names; an empty search says what to do instead of showing nothing; **a word typed at speed is one request, not one per letter**, the query that reached the provider is the whole word, and its `user-agent` is `Raspberry/…` — which is how "the request came from the server, not the browser" is measurable; a row reads as a **name over its context**; **the same landmark returned twice is one row**; `Use "…"` is offered beside the results; `ArrowDown`/`ArrowUp` walk the list while the table stays put; `Enter` stores **the point, lat/lng** (not GeoJSON's lng/lat) and the cell re-reads the address; picking **replaces the list with the map card** (B52) and the field still reads the address; **pressing the cell again reopens it** although the caret never left (the difference between a press-opens gesture and a focus-opens gesture); reopening shows **the card for the stored point** and asks the provider **nothing** to draw it, while a *typed* cell reopens as the list; the first `Escape` dismisses the list and the second gives the cell back its value **with nothing written**; a search that finds nothing names its query and `Enter` stores what was typed **as a string**; with the fixture **stopped**, the surface says the service could not be reached and `Enter` still stores the address; a **double press in the cell** does not open the row's page. Then the two searches the owner named, against rows recorded from the real provider: `Rašica 53` **asks the fixture twice** (the query and the query without its house number), the **first row is the address that was typed** — `Rašica 53` placed at `1315 Velike Lašče`, the postcode four of that road's six results are in — the other village (`1217 Ljubljana`) is on the list beside it, no row comes from another country, and the note says the point is **the road, not the door**; pressing that row stores `Rašica 53, 1315 Velike Lašče, Slovenija` with a point **and `approx: true`** read back from `/api/databases`, and the cell then reads that address; `Grahovo Brdo 1` is **headed by the address** with `Turistična kmetija Mahnič, 6210 Sežana, Slovenija` on the dim line and no "missing house" note. The two-request check is only asserted at the first width: both widths share one app process and a query is cached for ten minutes, so the second width proves the cached-then-ranked path instead. 51 assertions, 1400/390 |
| `scripts/run-places-probe.ps1` | Starts a disposable copy on :3108 with **`RASPBERRY_PLACES_URL` pointed at the probe's loopback fixture on :3117**, runs the place probe at 1400×900 and 390×844 **with a fresh seed per resolution**, stops it and deletes the copy. **`-Before` rebuilds the copy as it was before this turn** — the **ranker neutered** (provider order kept, every row headed by the place's own name) **and the composition removed** — and fails the run if the probe passes there. It scores **40/51** and its failures print `{"name":"Rašice 53","context":"982 62 Rašice, Slovensko"}` — the owner's complaint, reproduced. It refuses to run the probe at all if either rewrite did not apply, because a `-Before` that silently matched nothing reports the fixed tree's score as a failure of the fix. (Superseded: the previous `-Before` removed the Place branch from `cell-editor.tsx` entirely, which is the right check for the turn that built the feature and the wrong one for a turn about ranking — it fails for reasons that have nothing to do with ranking.) |
| `scripts/verify-db-place-map.mjs` | Proves the picked-place card with a real pointer on a **disposable** instance, against **two fixtures it starts itself on loopback** — a geocoder on :3118 and a **tile server on :3119 whose squares encode their own `z/x/y` in their pixels**. That second fixture is what turns "a map appeared" into a measurement: each square is sampled at three points and its colour names the square it should be, so a tile drawn one position off is a failing check and not a nice picture. It also counts: a cell that already holds a point opens as a **`dialog`** with **no list** and **no search request**; the card is headed by the stored address; the box is 226×150 (the size the grid computed, written inline so the tiles and the box cannot disagree); the squares are the **2×2 block OpenStreetMap's own tile formula gives** (the formula is re-implemented in the probe, not imported, because asking the app where a tile is and then agreeing with it proves nothing); neighbours are **exactly 256 apart at integer offsets**; the pin is on the box's middle within 1px; the dark-map filter is on; the attribution is the licence's own sentence with a link to it; the way out is a real `<a target=_blank>` whose `href` is asserted **whole**: `https://www.google.com/maps/search/?api=1&query=48.858400,2.294500` — Google Maps, asked in the coordinate the pin was drawn on, with the address text provably absent (no `%20`, no `+`, no `Eiffel`) because Google would re-geocode a sentence into a different pin; **every request the page made stayed on this machine** — an `<img>` pointed at a tile server draws the same pixels and would pass every rectangle-based assertion; picking **replaces the list with the card without a second click**; typing over it brings the list back; `×` empties the cell (read back from `/api/databases`) and leaves the caret in the field; a **composed** address gets a **ring** rather than a dot, the sentence *Placed on the road, not the door*, and **z15 instead of z16**; with the route made to answer **`503 tiles_off`** the card says the tiles are switched off — not that the map is broken — and keeps its pin; and the card fits a 390px window. 34 assertions, 1400/390 |
| `scripts/run-place-map-probe.ps1` | Starts a disposable copy on :3109 with **`RASPBERRY_PLACES_URL` and `RASPBERRY_TILES_URL` both pointed at the probe's loopback fixtures** (:3118, :3119), runs the card probe at 1400×900 and 390×844 **with a fresh seed per resolution**, stops it and deletes the copy. **`-Before` rebuilds the copy as it was before B52** — `placeCard()` replaced by `false` and `setOpen(false)` after every pick — and fails the run if the probe passes there. It scores **10/34**, and the four failures at the top print the old behaviour verbatim: `card false, role "listbox", rows 2` and `1 searches: […q=Eiffel%20Tower…]` — a cell with a point that searched the provider again and then showed a list |
| `scripts/seed-qa-files.mjs` | Seeds a disposable instance with a page holding one database whose `Files` column is a **Files & Media** property, and **five rows** — `Both` (a real 73-byte PNG and a real PDF, uploaded through `POST /api/files` so the references point at bytes that exist), `One` (a document alone, the no-count branch and the badge), `Nothing` (the empty cell), `Spare` (the upload target) and `Drop` (the drop target). `Spare` and `Drop` are separate because a cell that already carries an upload turns "the drop added a file" into a question about two writes. The PNG is inlined as base64 rather than read from the repo: a seed that depended on a fixture file would break when it moves. Used by `run-files-probe.ps1` |
| `scripts/verify-db-files.mjs` | Proves the Files cell with a real pointer **and real uploads** on a **disposable** instance. The uploads are the point: the probe drives the panel's real `<input type=file>` through CDP's `DOM.setFileInputFiles` (a real `change` on a real input, not a hand-made `FileList`), then reads the **stored** value back from `/api/databases` and fetches the bytes from `/api/files`. It checks: a Files cell holds **no text field** (the bug this turn removes — a typed name stored a reference to bytes nobody uploaded) and is a `button` announcing the dialog it opens; the cell reads **the first file, its tile and `+N`**, with the thumbnail painted and the document wearing a `PDF` badge; `Empty` when empty; pressing opens the shared **252px `dialog`** headed by the count, offering `Upload` as the small named button (`.db-mini-btn`, the same control the error banner's `Retry` wears); every attachment is listed with **the size the server stores**, a name that is a real `<a>` to its own bytes in a new tab, and a `×` in the bare glyph well; the three ways out (press again, `Escape`, press outside); a chosen file lands in the list, is stored as `{id,name,mime,size}` **with no `url` of its own**, and its bytes come back byte-identical; a batch of two where **one is refused** still commits the one that landed and names the refused file in a `role=alert` line; removing a row takes the file out of the cell **and leaves the blob serving 200**, because the store is content-addressed and another cell may be using it; a **dropped** file (a real `DataTransfer` made in the page, so our own handlers run and the browser's do not) uploads like a chosen one; and the seeded cells were never rewritten; each row offers a **save** (`↓` in the same bare well) whose link is asserted, and the `Content-Disposition` of both URLs is read **from the page** — the save is `attachment` carrying the stored name, the view is still `inline`; hovering an image row with a real `mouseMoved` shows a **268×224 preview in the body** (outside the panel, which clips), with the picture painted, the caption naming the file and its size, `pointer-events: none` and `aria-hidden`, and **beside the panel rather than over it** at 1400; a **PDF row produces no box at all**; leaving the list takes it away, and hovering the **thumbnail of a closed cell** previews the same file without opening anything. 47 assertions, 1400/390 |
| `scripts/run-files-probe.ps1` | Starts a disposable copy on :3110, runs the files probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe uploads and removes files), stops it and deletes the copy — with the copy's `data/uploads` blobs inside it. No fixture server: unlike the place probes, every request this feature makes is to `/api/files`, which is ours. **`-Before` reverts the current turn** (B54: the save link back to plain `fileHref`, both `<FilePeek>` renders to `{null}`) and fails the run if the probe passes there; it fails **7 of the 10 new checks**, by name, at both widths (40/47 — the three that still pass are the *absence* ones, which a tree with no preview satisfies trivially), and refuses to start the app if either rewrite did not apply. (B53's own before-tree — the `files` branch struck out of `cell-editor.tsx`, so the column falls back to a text field — was measured in that turn; reverting it here makes §1 fail and skips the hover section, which is the wrong thing to re-prove.) |
| `scripts/seed-qa-formula.mjs` | Seeds a disposable instance with a page holding one database whose columns are `Name`, `Price`, `Done`, `Due` and **three formula columns** — `Total` (`prop("Price") * 2`, arithmetic over another column), `Label` (`concat("Total ", prop("Total"))`, text built from *another formula*, which is how the memoised formula-of-formula path is exercised from the outside) and `Open` (`not(prop("Done"))`, a checkbox) — with **three rows**: `Alpha` with every input filled (`80`, `Total 80`, `No`), `Beta` with the number alone (`14`, `Total 14`, `Yes`) and `Gamma` with nothing at all (every formula `Empty`, which is not `0`). One row would only prove one of those states. The expressions are stored, not hard-coded in the probe, so the probe asserts what is stored rather than a fixture. Used by `run-formula-probe.ps1` |
| `scripts/verify-db-formula.mjs` | Proves the formula column and its editor with a real pointer on a **disposable** instance. The language itself is `tests/database-formula.test.ts`'s job; this is the app: the column **computes** (`80`, `Total 80`, `No`, `14`, `Empty` — read off the cells, so the server's read path is under test), a formula cell is a **`button` with no field** that announces a dialog, and the panel opens **on the stored expression** with the painted layer's text **exactly equal** to the field's (the only assertion that can catch the two layers drifting apart) and its tokens wearing the property/number/operator colours. The browser lists **Properties, Built-ins, General, Text, Number, Date, List** in that order, names the columns, and does **not** offer the formula itself (a reference would always be a loop). Typing `dateB` narrows it to one name and `Enter` writes `dateBetween()` with the caret **inside the brackets** and the arity error underneath; `prop("Du` narrows it to columns and inserts a complete `prop("Due")` that evaluates to a date. The preview follows the expression (`80`) **and the page** (`14` on `Beta`), debug mode lists every node with its type and puts the answer at the top, closing commits `prop("Price") + 5` **once** and the cell re-reads `45` — including `Label`, which reads `Total` — while `Beta` reads `12` and `Gamma` stays `Empty`. The header's `Edit formula` row opens the same editor on the same expression, and a direct `PATCH` of a value into the column is **refused** (`derived` means never written). 43 assertions, 1400/390 |
| `scripts/run-formula-probe.ps1` | Starts a disposable copy on :3111, runs the formula probe at 1400×900 and 390×844 **with a fresh seed per resolution** (the probe rewrites the formula, so a shared database would make the second width start from the first one's edit), stops it and deletes the copy. No fixture server: every request is to `/api/databases`, which is ours. **`-Before` rebuilds the copy as it was before this turn** — `applyFormulas` taken off the read path and the formula branch taken out of `cell-editor.tsx` — and fails the run if the probe passes there. It fails **the first nine checks by name** at both widths and prints the old bug verbatim: `<input class="db-cell-input" aria-label="Total">` inside the formula cell and an empty value. It refuses to start the app if either rewrite did not apply, because a `-Before` that silently matched nothing reports the fixed tree's score as a failure of the fix |
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



