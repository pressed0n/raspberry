> **ARCHIVED — history, not guidance.** Superseded by [`docs/STATE.md`](../STATE.md).
> B38–B40 shipped against this plan; B41–B45 have not. Its § 7 risks section correctly
> predicted the two live defects now recorded in `STATE.md`.

# Database — implementation plan (v2)

> **Source of truth for the wishlist:** the page **"Database Feature Wishlist"**
> (`9be37247-a956-4e2f-b5ab-7ab7cf507d35`), read out of `data/raspberry.sqlite`
> on 30 Oct 2026 — not from memory of it. 30 checklist items, all unchecked.
>
> **State audited:** `src/lib/database/{types,properties,rows}.ts`,
> `src/server/{migrations,databases,service}.ts`, `src/components/database/*`,
> `src/app/api/databases/**`, `tests/databases.test.ts`.
>
> Plan written 30 Oct 2026. Supersedes v1. Proposed as **B39–B45** (B38 is already
> in the working tree — see §3).
>
> **Revision, 30 Oct 2026 (after B40a):** the substrate passed its tests while the
> block was still unusable in the browser — a 331px stub with an unlabelled `+` and no
> discoverable way to add a row. See **B40a** in §5. The lesson is recorded as a rule in
> §8: a phase is not done when its tests pass, it is done when the thing it built can be
> used and has been looked at. Every phase below now ends with a screenshot.

---

## 1. The page, verbatim

The nesting is the specification. `Properties for all future views` is the parent of
everything else — the 16 property types are not table features, they are
**database** features that every future view inherits.

```
[ ] Database Table view
[ ]   Properties for all future views
[ ]     Name (Primary property)
[ ]     Add Property - in the table header
[ ]     New page - In the second row of the table
[ ]     Text
[ ]     Select - create a custom list of tags, only one tag selected at a time.
                   Tags can have colors. Create or select tags in a dropdown
[ ]     Status - Glorified Select. Tags grouped in parent statuses. Default groups
                  should be "To-do" "In progress" "Complete". Notion has the same but
                  they are locked into those groups. I would like groups to be
                  customizable, add more, remove etc.
[ ]     Person (user)
[ ]     Checkbox
[ ]     Phone
[ ]     Number
[ ]       Number format (Currencies, percent, number, number with separators, hours,
[ ]                       minutes, seconds)
[ ]       Decimal places
[ ]       Display options:
[ ]         Number
[ ]         Bar or Ring
[ ]           Can select color
[ ]           Divide by X
[ ]           Show number toggle
[ ]     Multi-select - Same as select but can select multiple at once.
[ ]     Date
[ ]       Calendar view
[ ]       Possibility to add End date
[ ]       Date format
[ ]       Option to be more granular and set hour and minutes. Start and end date
[ ]                       could in theory be on the same day and last 8 hours.
[ ]     Files & Media
[ ]     URL
[ ]     Email
[ ]     Button
[ ]     Formula - can take other properties to do math
[ ]     Created time
[ ]     Place/Location
[ ]       Accepts address
```

Three items are **table chrome**, sixteen are **property types**, one is a **view
type**, and `Calendar view` is nested under `Date` because a date property is what
makes a calendar possible at all. That last detail is the whole design:

> **Properties are the database. Views are projections of it.**
> Nothing a view does may ever be defined inside the view.

---

## 2. The three axes

Everything on the page lands on exactly one axis, and the axes must not touch.

| Axis | Owns | Stored in | Extended by |
| --- | --- | --- | --- |
| **Property** | what a cell *means* — parse, compare, format, filter, aggregate | `database_properties` (+ `pages.title` for primary) | adding one registry module |
| **View** | how rows are *shown* — filter, sort, group, which columns, widths, row height | `database_views.config` | adding one component + one registry line |
| **Row** | a *record* — id, title, cells, position | `pages` (`database_id` set) + `database_cells` | nothing; rows are pages already |

16 types × N views is a matrix. The only way that matrix stays writable is if the
views never learn what a type is. That is why `table-view.tsx` renders `formatCell`
output as text and nothing else — it is the proof the seam holds.

---

## 3. What already exists (B38 — audited, uncommitted)

Do not rebuild any of this.

| File | What it is |
| --- | --- |
| `src/lib/database/types.ts` (303 L) | The whole vocabulary. 16 property types, 5 view types, `filterOperators`, tag palette, and **a Zod config schema for every type including the ones built later**. Row/Property/View/`DatabasePayload` wire shapes, plus the *write* schemas (`createPropertySchema`, `patchViewSchema`, …). |
| `src/lib/database/properties.ts` (184 L) | The property registry. Currently **only `text` and `number` have specs**; the other 14 are vocabulary-only. |
| `src/lib/database/rows.ts` (156 L) | `load → filter → sort → group → window`. Pure, no I/O. |
| `src/server/migrations.ts` | Migration 6: `databases`, `database_properties`, `database_views`, `database_cells`, `ALTER pages ADD database_id`. |
| `src/server/databases.ts` (198 L) | `create` / `get` / `patch` only, with `mutationId` replay and `expectedRevision`. |
| `src/components/database/*` | `database-block` (fetches, tabs, rename), `table-view` (pure renderer), `use-database` (the only fetch site). |
| `tests/databases.test.ts` | Migration, replay-safety, cross-workspace refusal, revision conflict, and the row-set pipeline. |

**Four decisions already made that must not be undone:**

1. **A row is a page.** `pages.database_id` set, `parent_id` NULL. Rows get page
   bodies, breadcrumbs, trash, restore and search for free. `service.ts` already
   excludes them from the sidebar tree and refuses to move them.
2. **The primary property is `pages.title`**, with the reserved id `"title"`. It is
   not a row in `database_properties`, so a new database has zero property rows and
   `Name` still renders. `position: -1` pins it first.
3. **Cells are JSON in one table**, keyed `(row_id, property_id)`. No column-per-type,
   no migration when a type is added.
4. **Options live in property config with stable ids**, so renaming a tag is one
   property write and every cell follows.

**What is *not* there yet:** everything below §5. The server has `create/get/patch`
and no `addProperty`, `addView`, `addRow` or `setCell`; the client table has no
editing at all (`onNewRow` / `onAddProperty` are optional props the block never
passes); `database-block.tsx` hardcodes the one view type.

---

## 4. The extension points to add before any feature

These are infrastructure, not features. They are what make the rest cheap.

**4.1 A client view registry.** Today `database-block.tsx` does
`view.type === "table" ? <TableView/> : "not built yet"`. Replace with
`src/components/database/views/index.ts`:

```ts
export const viewRenderers: Record<ViewType, ViewComponent> = { table: TableView, /* … */ };
```

Adding Gallery later becomes one import and one line, and the block never changes
again.

**4.2 A cell kit.** One component per type that renders *and* edits, keyed by type —
`src/components/database/cells/index.ts`, same shape as the property registry. The
table asks `cellFor(property.type)` and gets a component with `{ property, value,
onChange }`. The table still knows nothing about any type.

**4.3 The property registry grows by module.** `properties.ts` becomes
`properties/index.ts` plus one file per type once it passes ~200 lines. The spec
interface (`empty/coerce/isEmpty/compare/format/fits/aggregates`) already has exactly
the seven methods every view will ever need — including `fits`, which is what stops
each view inventing its own filter comparison.

**4.4 Mutation envelope, one shape.** Every write is
`{ mutationId, expectedRevision?, ...patch }` and every response is the full
`DatabasePayload`. The property and view write schemas already exist; they just need
routes and service methods that use them.

**4.5 Formula is an AST, never `eval`.** `configSchemas.formula.expression` is a
string today and must stay a string: parsed to an AST, evaluated over other
properties' values. `eval` is permanently off the table.

---

## 5. Phases

Each phase is independently shippable and independently testable. Order is by
leverage: registry first, because every cell editor and every view reads it.

### B39 — Finish the registry (14 specs, pure, no UI) — **DONE**

*(Shipped: `src/lib/database/property-types/` — one module per type plus `shared.ts`;
registry is now a full `Record`, so a new vocabulary name fails the build until its
module exists. `readOnly` and `derived` were added to the spec interface so the write
path can refuse rather than views special-casing. Two rules were tightened while
writing the tests: a phone needs ≥6 digits, and a button's `format` is empty — a label
is the control's, not the value's. 30 tests in `tests/database-properties.test.ts`.)*

`checkbox, url, email, phone, person, select, multiSelect, status, date, files,
createdTime, place, button, formula`.

For each: `coerce` (unknown JSON → canonical value), `isEmpty`, `compare`, `format`,
`fits` (which `filterOperators` apply, and how), `aggregates`.

This is the wishlist's `Text`…`Place/Location` items **as semantics**. No pixels.

- **Tests:** `tests/database-properties.test.ts` — per type, a table of
  `(raw → coerced → formatted)` plus filter-operator coverage; assert every
  `PropertyType` has a spec (`satisfies Record<PropertyType, …>` makes it a compile
  error to forget one).
- **Done when:** `resolveProperty` cannot throw for any type in the enum; the 12
  `format` outputs on real values are asserted, not eyeballed.

### B40a — The block a person can actually use — **DONE**

Not in the v2 plan, because the v2 plan assumed a working table was the *start* of the
work rather than a thing that had to be earned. Written after opening the block in a
browser and finding three defects that every existing test passed through:

1. **The block never claimed its width.** `.db-block` is a flex *item* inside
   BlockNote's `.bn-block-content`, which is itself a flex container, so it was
   content-sized — 331px in a 660px column. The table's `min-width: 100%` dutifully
   filled 331px. Fixed with `flex: 1 1 auto; width: 100%; min-width: 0`.
2. **The type scale lost the cascade.** BlockNote ships `.bn-editor table { font-size:
   var(--fs-body) }` and `.bn-default-styles p { font-size: inherit }` — both `(0,1,1)`,
   both beating the widget's `(0,1,0)` rules. The table and every hint paragraph were
   rendering at 16px prose size. Fixed by scoping to `.db-block .db-table`,
   `.db-block .db-hint` (`(0,2,0)`).
3. **Nothing said how to add a property or an entry.** The header `+` had only a
   `title`; the add-row control said "New page", which read as the sidebar's button. Now
   it says **New row** (with a tooltip saying rows are pages), and an empty database
   carries one line of guidance pointing at both controls.

Regression: `scripts/cdp-db-usability.mjs` — adds a property, adds a row, types a name,
reloads, and asserts the value came back; also asserts the block fills its column and the
table is on the widget's type scale. 10/10.

### B40b — The column header becomes a property menu — **DONE**

Three owner-requested fixes, all of them inside the header, plus one word:

1. **"New row" → "New entry."** The wishlist's next views are a calendar and a board,
   which have entries but not rows. A table-specific word would have to be renamed again
   when the second view lands, so the neutral word goes in now.
2. **Columns are draggable.** Widths persist in `view.config.widths` — the field already
   existed and nothing wrote it. The handle lives *inside* the column (`right: 0`) rather
   than straddling the border, because at `right: -3px` its centre sits on the boundary
   where the next `<th>` paints over it and swallows the pointerdown.
3. **Clicking a header opens a menu** with rename, an icon grid, and Sort A→Z / Z→A.
   The same menu drives every column including the primary one.

What made this more than three small edits:

- **The primary property has no row to write to.** `pages.title` *is* the first column, so
  there is nothing in `database_properties` to rename. Migration 7 adds
  `databases.title_property` (JSON: name + icon) and `database_properties.icon`. Reads
  merge the former over the `titleProperty` constant via `titlePropertyWith()`.
- **`PATCH /properties/:propertyId` rejected the primary id.** It validated every id with
  `z.string().uuid()`, so `"title"` 400'd — the one column every database has was the one
  column that could not be renamed. The route now passes the reserved id through.
- **View config has its own endpoint.** `PATCH /api/databases/:id/views/:viewId` merges a
  partial config and does **not** bump `databases.revision`, for the same reason a cell
  edit does not: widening a column is not a schema change, and bumping would make another
  tab's next structural write look like a conflict.
- **`table-layout: fixed` alone does not make a drag 1:1.** With no auto-width column the
  browser hands leftover space to the data columns, so a 70px drag moved the edge 36px.
  A trailing filler column absorbs the remainder; every property column now keeps exactly
  the width it was given. The filler is excluded from the CSS counts the older tests use.

Regression: `scripts/cdp-db-columns.mjs` — opens the Name menu, asserts its three
sections, renames to "Task", picks the flag icon, sorts Z→A, drags a column 70px, then
**reloads and asserts all five survived**. 16/16 at 1400 and 16/16 at 390.

### B40c — The "Name Property and Basics" page — **DONE**

Four items from the owner's page, and the infrastructure each one needed:

1. **The property menu is built from primitives**, not hand-rolled. `menu.tsx` owns one
   surface, one item, one divider, one submenu and one dismissal rule; the property menu,
   the icon picker and the hidden-columns list are now compositions of it. Adding a row is
   one `<MenuItem>`. The menu only lists what works today — **Sort** (submenu), **Hide**,
   **Duplicate property**, **Delete property**, with the type named at the foot where
   "Change type" will go. Filter / Calculate / Freeze / Property access are deliberately
   absent rather than dead.
2. **An icon picker**, replacing a 42-cell inline grid: search, shuffle, Recent
   (`localStorage`), and a 147-icon vocabulary in `property-icons.tsx`. One picker serves
   both a property *and* an entry.
3. **Entries have icons inline before their name.** An entry is a page, so the icon *is*
   `pages.icon` — the same column the sidebar reads. `PATCH /rows/:id` now accepts `icon`.
   `none` is a real value meaning "no icon", distinct from absent ("use the default").
4. **The cell is the box.** `.db-cell` lost its padding, `.db-cell-input` fills the cell and
   carries the single inset, and the hover affordance is an outline rather than a second
   background. `+ New entry` is now an inline-flex button that hugs its label (102px, not
   100%).

Bugs this surfaced — each one found by driving the app, not by a unit test:

- **A menu could not be opened by a real mouse.** Menus open on `mousedown`; React flushes
  the dismiss effect *inside that same dispatch*, so the document listener was armed before
  the press finished bubbling and closed the menu the press had just opened. Every synthetic
  test passed, because `dispatchEvent` does not reproduce that flush ordering. The listener
  is now armed one task later. This is the single most important line in `menu.tsx`.
- **The editor's `td` rules out-specified `.db-cell`.** Same cascade trap as the font-size
  bug in B40a, but for padding: `.bn-editor table td` is (0,1,1)+ and beat `.db-cell`
  (0,1,0), so the cell kept 10px of editor padding around a control that was already inset.
  Fixed at (0,3,0): `.db-block .db-table .db-cell`.
- **`pages.icon` names were not in the icon map.** Page icons (`file`, …) are a different
  vocabulary, and every entry is a page — so every row whose sidebar showed a document
  rendered the *fallback* glyph (a "T") in the table.
- **A new column could be created invisible.** With `visibleProperties` empty (the default)
  every column shows; the moment one column is hidden the list becomes explicit, and a
  property added afterwards is not in it. `addProperty` now appends the created id.

Regression: `scripts/cdp-db-menu.mjs` — 24 assertions, including *pixel* geometry (cell
padding is `0px`; the control matches the cell to within 1px; the button is under 160px),
an entry icon set → reload → still set, Hide → chip → restore, Duplicate → reload. 24/24 at
1400 and 24/24 at 390. `scripts/check-icons.mjs` guards the icon vocabulary: a missing lucide
export is an `undefined` component that only fails in the one picker nobody opened.

### B40d — The row gutter: hold, add, tick — **DONE**

A database row is an object like every other object in the document, so it gets what every
other object gets: a six-dot grip to move it, a `+` to put another one below it, and — because
a table view is the only place multi-select is useful — a checkbox.

The gutter is the table's **first column**, not a panel floating beside it. `.db-table-wrap`
scrolls on its own axis, so anything positioned outside it is clipped the moment the table is
wider than the page; being a column is also the only arrangement in which the `colgroup`, the
header and every row agree on where the table starts. `GUTTER` in `table-view.tsx` is a
constant for the same reason.

**The three complaints on the owner's page, and what each actually was:**

1. **"It broke the table view."** Two *empty bordered bands* ran the height of the table: the
   `+` column was a fully bordered 48px cell repeated down every row, and the filler column —
   which exists only to absorb leftover width so a column drag is 1:1 — carried a `border-left`
   of its own. Both are now borderless; the line between the last data column and the `+` is
   not lost with them, because that line is the last data cell's own `border-right`, and in
   `border-collapse: collapse` the neighbour draws it. The `+` loses its right *and* bottom
   border so the header's rule ends on the same column the body's rules end on.
2. **"You did not re-use the 6 dot grip and plus components that are already established."**
   Correct, and the fix was structural rather than cosmetic. The editor had both glyphs —
   `GripGlyph`, `AddGlyph`, path-for-path copies of BlockNote's own — but they were private to
   `editor/object-menu.tsx`, so the gutter had been written with lucide's `GripVertical` and
   `Plus`. Same names, different shape: lucide's dots are hairlines, the established ones are
   filled. They now live in **`src/components/grip-glyphs.tsx`** and both call sites import
   them. The *geometry* was reused too: the pair is `.frame-anchor`'s **39×30**, split between
   two `flex: 1 1 0` buttons — so each button is **19.5px**, not the 20px this first shipped
   with. Half a pixel is what makes two grips read as two controls.
3. **"Checkbox is not inline with grip and plus."** The three were inline siblings while
   `.db-check` was `display: block; margin: 0 auto` — a block box in an inline formatting
   context breaks out of it and starts its own line, so the tick sat *below* the pair. No
   amount of `vertical-align` fixes that; they are one `inline-flex` row now
   (`.db-gutter-inner`), and all three share a centre to 0.00px.

Found while fixing those:

- **`.db-check` was declared twice in `database.css`** — a 13px native box and a 15px framed
  one 300 lines later, so the later silently won and the 13px box never existed. One
  definition now, with `appearance: none` and three states (`:checked` for the gutter's real
  `<input>`, `[aria-checked]` for a checkbox *property*, whose value is a
  `<button role="checkbox">` because a click has to commit through the cell, and
  `:indeterminate` for select-all).
- **Hiding `.db-check` until hover hid a checkbox *property's value*.** Same class, two jobs.
  The hover rule is now scoped to `.db-gutter`, so a Checkbox column no longer looks empty on
  every row until you point at one.
- **The header was 0.5px shorter than the rows** (32.5 vs 33) — a `border-collapse` rounding
  artefact, left alone: at 1:1 it is invisible and forcing it would make the border maths lie.

Regression: `scripts/cdp-db-gutter.mjs` — 20 assertions, driven by a **real
`Input.dispatchMouseEvent` hover** (a synthetic `dispatchEvent` cannot reproduce the ordering
that ate a menu in B40c, so it is not trusted for anything involving a pointer). It asserts
the shared *glyph paths* (`M11 18c0 1.1…`, `M192 474h672…`), the 39×30 pair, 19.5px buttons,
a shared centre, and that every ghost column draws zero border on all four edges. **20/20 at
1400 and 20/20 at 390.** Read-only by construction: it hovers, measures and screenshots, and
never presses a control that writes.

The reusable-component failure above is now a rule in **`AGENTS.md` § "Reuse before you
write"**, with an index of where the shared vocabulary lives. A rule in a plan is read by
whoever opens the plan; a rule in `AGENTS.md` is read at the start of every session.

> **Corrected by B40e.** "The gutter is the table's first column" was the diagnosis that
> caused the owner's next complaint — a column indents the grid, and hanging outside it
> does not. And "reused the glyphs" was not the same as "reused the component"; the
> buttons were still hand-rolled.

### B40e — The gutter leaves the table; the pair becomes a component — **DONE**

Two items left on the owner's page, and both were still true after B40d:

1. **"It broke the table view … the table is not aligned left to the new page and table."**
   Measured, not guessed: the editor column, the view tab and `+ New page` all start at
   **x = 491**, and the table's Name column started at **551**. The gutter was a 60px first
   column, so it indented the entire grid by 60px and left a bordered empty band down the
   left of the table.

   The gutter now hangs in the page margin, outside the table's own box:
   - `.db-gutter` is a **zero-width** cell with `position: relative`; `.db-gutter-inner` is
     absolutely positioned at `inset-inline-end: 0` with `width: var(--db-shelf)`, so it
     grows leftwards out of the cell and the pair inherits the row's vertical centring for
     free — no measured row heights;
   - `.db-table-wrap` borrows exactly that much room (`margin-inline-start: -60px;
     width: calc(100% + 60px)`) and the table is pushed back by the same amount, so the data
     grid lands on the content edge and the controls occupy space the wrapper borrowed;
   - `min-width` follows the shift, or `100%` would measure the borrowed 60px and hang the
     table off its own right edge.

   Two numbers only, declared once on `.db-block`: `--db-shelf` (60px) and `--db-col` (0px).
   Below **860px** both flip (0 / 60) and the gutter becomes a real first column again —
   there is no page margin to hang a 60px shelf in when the editor's own inset is 24px, and
   hiding the controls would take reorder and multi-select away from touch entirely. The
   indented grid on a phone is the deliberate half of that trade, asserted rather than
   assumed.

2. **"You STILL did not re-use … sure you re-used the icons, but not the actual same
   component with the same behaviour."** Correct again, and this is the part B40d only
   half-did. The pair is now **`FrameAnchor`** (`src/components/frame-anchor.tsx`) and both
   hosts render it: the editor's object menu (`object-menu.tsx`) and the database row. The
   host decides only *where it sits* — `inline` adds `.frame-anchor--inline`
   (`position: static`), nothing else. The box, the two `flex: 1 1 0` buttons, the order, the
   labels and the whole hover behaviour are the component's.

   `.db-gutter-inner .frame-anchor { flex: 0 0 auto }` exists because a fractional table
   column silently shrank the shared component to **38.5** and its buttons to **19.25**.
   A shared control must render at the size it was designed at in every host.

Found while fixing those:

- **A control can be geometrically perfect and still be invisible.** `.bn-editor table` sets
  `overflow: hidden` at `(0,1,1)` — beating `.db-table` — and every `td` is `.db-cell`, which
  clips for truncation. Both clip the shelf to nothing, since it lies outside both boxes.
  The DOM was right, the opacity was 1, the rects were right, and there were no pixels.
  `.db-block .db-table { overflow: visible }` and `.db-gutter { overflow: visible }` fix it;
  the assertion is `elementFromPoint`, not `getBoundingClientRect`.
- The three complaints above are now **enforced in source** by `tests/frame-anchor.test.ts`:
  one file may render `.frame-anchor`, one may import the glyphs, the object menu and the row
  must both render `<FrameAnchor>`, `database.css` may not re-declare `.db-pair`/`.db-plus`
  or restyle `.frame-grip` beyond its cursor, and the two gutter variables may be declared
  exactly twice. A pixel-perfect copy would still pass a DOM test; it cannot pass this one.

Regression: `scripts/cdp-db-gutter.mjs` rewritten — **28 assertions at 1400, 25 at 390** —
including the alignment triple (content = tab = table), the pair hanging strictly left of the
table, glyph paths compared against **BlockNote's own side menu on the same page**, 19.5px
buttons, shared centre, zero borders on the ghost columns, and "the shelf's own pixels are
what the pointer hits". `scripts/cdp-frame-anchor.mjs` (new, read-only) proves the extracted
component still opens and closes the editor's object menu after the refactor: **9/9**.

### B40f — The grip gets the verbs every other grip has — **DONE**

Four items on the owner's page, and the first was a repeat of B40e's: *"You STILL did not
re-use the 6 dot grip and plus … All other objects, when clicking on the 6 dot grip open up a
dropdown menu, same should happen here and the dropdown should contextually show only
Duplicate and Move to trash."*

**1. The grip opens a menu.** It now does what every other grip in the app does, plus what a
row's grip uniquely does: a **press that never moves is a click** (opens the menu), a press
that travels 4px is a drag. `suppress` eats the `click` that follows a real drag, so the two
gestures share one button without either firing the other. The menu is `menu.tsx`'s
`MenuSurface` + `MenuItem` — portalled, so the table's `overflow-x: auto` cannot clip it
(unlike `.frame-menu`, which is absolute) — with two verbs:

| item | request |
|---|---|
| Duplicate | `POST /api/databases/:id/rows/:rowId/duplicate` |
| Move to trash | `DELETE /api/databases/:id/rows/:rowId` |

Both are new server methods (`duplicateRow`, `trashRow`) with `mutationId` replay, and both
are covered in `tests/database-writes.test.ts` — including the refusal that matters: a row
id belonging to *another* database answers **404** through this one's URL. Proved live once
as well, on the last row of a test database: duplicate → **200** with the copy in the slot
below and its cells copied, then the copy trashed → **200**, row set identical afterwards
(the insert renumbers positions, which every insert does).

**2. The controls never take a column, at any width.** B40e flipped the gutter back into a
60px first column below 860px and called it a trade. The owner called it *"stupid since all
other objects don't function like that"*, and was right: a column indents the grid, and the
grid is the thing that has to line up with the page. Now there are three numbers, and only
one of them may move:

| variable | wide | phone | may a media query change it? |
|---|---|---|---|
| `--db-shelf` (what the controls occupy) | 60px | 60px | **no** |
| `--db-col` (the gutter's column width) | 0 | 0 | **no** |
| `--db-borrow` (page margin the wrap borrows) | 60px | 0 | yes, once |

Below 860px there is 24px of margin against a 60px shelf, so the shelf **docks inside the
row's left edge** and the Name column takes the same 60px as an inset. The table's left edge
stays on the content edge either way — measured **24 = 24** at 390px, **502 = 502** at 1400.
`tests/frame-anchor.test.ts` now fails if any media query touches the shelf or the column.

**3. "Remove the left border of the table."** Not the wrapper's — that went in B40a. It was
the *first data cell's* own border: `tr > :first-child { border-left: 0 }` was written when
the Name cell was first-child, and once a zero-wide gutter moved in front of it, the Name
cell's left border became the table's left edge. `.db-gutter + *` clears it too.

**4. "Row horizontal dividers should continue to the full width of the table."** The divider
rule excluded `.db-cell-add` and `.db-cell-filler`, so a rule stopped at the last data column
and the two ghost columns looked like a half-ruled table hanging off the right. They are
still borderless on their sides — they are not columns — but the divider is not a column's
border, it is the grid's, and it now runs to the table's right edge.

**5. "Grabbing and dragging … a low opacity instance hooked to the cursor."** The row drag
draws `DragLayer` — the *same* component and the same `.tree-ghost` (0.86 opacity, portalled,
`position: fixed`) that the sidebar uses for a dragged page — plus `.tree-drop-line` at the
gap the drop would land in. A drop onto the row being dragged draws no line and sends no
request, because it would change nothing.

**Three bugs that only a real browser found:**

- **The docked shelf was unclickable.** `.db-name-cell` is `position: relative`, so below
  860px the Name cell — later in the DOM — painted over the absolutely positioned shelf and
  swallowed every press. The buttons were visible, hoverable-looking and completely inert.
  `.db-gutter-inner { z-index: 1 }`.
- **The menu could not be closed with Escape.** `MenuSurface` took an `onClose` and never
  used it; dismissal lives in `useMenuDismiss`, which the property menu calls and the row
  menu did not. The row menu calls it now.
- **`reorderRows` had been answering 500 for days** — not a code bug: `runtime.ts` memoises
  the `Databases` *instance*, so a hot-reloaded class is never picked up and a method added
  an hour ago answers "is not a function" until the process restarts. Recorded in
  `runtime.ts`, because the next person to add a method will hit it too.

Regression: `scripts/cdp-db-rowmenu.mjs` (new) — **34 assertions at 1400 and 34 at 390**,
read-only by construction: it intercepts every `/api/databases` request with `Fetch.enable`,
asserts the URL and body the UI built, and **fails the request** so nothing is written. The
last assertion is `sent === intercepted`, i.e. nothing escaped. `scripts/cdp-db-gutter.mjs`
updated to the new contract (33 at 390, 34 at 1400), `cdp-frame-anchor` 9/9,
`cdp-database` 14/14, unit **391/391**, `tsc` 0.

### B40g — The seven basics, and the two ways a click "selected" the block — **DONE**

Seven items on the owner's page, opening with *"Still not good"*. Six were visual. The fifth
was a data-loss hazard wearing a highlight.

**1. "New page button is misaligned."** It was 60px left of the table, because B40g's
predecessor moved the *table's* controls out of the flex flow but left the button inside
`.db-table-wrap` — and that wrapper borrows 60px of margin, so everything inside it inherits
the borrow. The footer, the hint, the count and the selection bar are now siblings of the
wrapper; the wrapper scrolls the grid and nothing else. The button's glyph sits on the
table's rule (491 = 491) and its hover shape bleeds 9px into the margin rather than into the
grid.

**2. "The row line is missing under the Plus for adding the property."** Exactly that:
`.db-th-add` was declared `border-bottom: 0` from when `+` was a bare glyph slot with no
column of its own, so the header's rule stopped at the last data column while every body row
ran the full width. The header and the filler now keep their bottom edge and lose only their
sides — which is the rule that says "this is not a column" without saying "the table ends
here".

**3. "After the Plus for add property lets also add a text."** The column is 132px — one
`ADD_COLUMN` constant, because the number appears twice (the `<col>` and the table's `width`
sum) and two literals drift. The glyph is `AddGlyph`, the same filled plus the gutters use,
not lucide's hairline one; `tests/frame-anchor.test.ts` now distinguishes the two cases it
was conflating — a lone `AddGlyph` is the vocabulary being reused, a `GripGlyph` outside
`FrameAnchor` is the pair being rebuilt.

**4. "The property row shouldnt be black… text and icons inside should be darker, not
white."** The band was not `.db-th`'s. `globals.css` sets `.bn-editor th { background:
var(--sunken); font-weight: 600 }` at (0,1,1), which beats any single class — the same
cascade trap this stylesheet documents twice already, for font-size and for padding. Scoped
to `.db-block .db-table .db-th`, the header gets the page's own surface and the 500 weight
its label was written for, and the Name column stops being the brightest thing in a header of
labels.

Verified two ways, because "the cell is transparent" is not the same claim as "nothing there
is painted": the test asserts every element in the header row with a non-transparent
`backgroundColor`, and the rendered pixels were sampled — header `(600,355)` is `R13 G12
B12`, the data row below it `R13 G12 B12`, the page above it `R13 G12 B12`. The faint band I
thought I could see in the screenshot was the rules around it, not a fill.

**5. "Clicking on the database block highlights it to primary colour and its stuck until you
refresh."** Two separate ProseMirror paths, which is why one click looked harmless and the
next did not:

| press | path | gated by |
|---|---|---|
| first click on an inert area | `selectClickedLeaf` → `NodeSelection` | `spec.selectable !== false` |
| the next press in the same place | `Selection.near` → `NodeSelection` | **nothing** |

`selectable: false` on the block spec closes the first path (and disarms the Backspace that
would have deleted the whole database behind an invisible selection). The second needed the
block to own its presses: a **native capture-phase `mousedown` guard** on `.db-block` stops
any press that did not start on one of the block's own controls, before ProseMirror's
bubble-phase listener on `.tiptap` ever sees it. React's `onMouseDown` could never have done
this — its listeners are attached to the React root, *above* the editor's DOM, so ProseMirror
has already acted by the time any of them runs. That is the third time this file has been
bitten by "React runs later than you think".

The guard's match must be *inside* the block: BlockNote's editor root is itself
`contenteditable="true"`, so a bare `closest()` found it from every press and excused all of
them — the guard was attached, correct, and never fired once.

Because the guard stops propagation on inert presses, both menu dismissals moved to the
capture phase (`useMenuDismiss`, and the add-property menu's own listener). A menu that
cannot be dismissed by clicking the table beside it traps the user in it.

**6. "Remove the icon next to the database name."** Gone, and the title's text now starts on
the block's left edge — the 4px hover inset is taken back by a negative margin, the same
trade `.db-new-row` makes. The empty-state hint no longer points at "the `+` in the header";
it names the button that exists.

**7. "On smaller screens, you're still doing what I asked you to not do."** B40f docked the
shelf inside the row below 860px and inset the Name text by 58px. The owner's two reasons are
both decisive: a phone has no hover, so the three controls that inset made room for could not
be reached anyway; and an indented grid is an indented grid. So the *page* pays, at every
width, with no breakpoint anywhere:

```css
.doc:has(.db-block) {
  max-width: calc(var(--measure) + 2 * (var(--db-shelf) - var(--s5)));
  padding-inline: var(--db-shelf);
}
```

`:has()` so pages without a database do not pay; the box grows by the *difference* so the
measure is 708 before and after (`.doc` is `border-box`, so raising padding alone would have
narrowed the text column to 588). B40f's table said `--db-borrow` "may be changed by a media
query, once". It may not. `tests/frame-anchor.test.ts` now fails if *any* media query touches
the shelf, the column or the borrow, or indents a cell.

The one thing a coarse pointer does change: `.db-check` is revealed under `(hover: none)`.
The grip already reveals itself there — in `FrameAnchor`'s own stylesheet, where it belongs;
restating it in `database.css` was the host restyling the shared component, and the
frame-anchor test caught it.

**Evidence.** `tsc` 0 · unit **392/392** · `scripts/cdp-db-basics.mjs` (new, read-only)
**29/29 at 1400 and 29/29 at 390** — the seven items plus the regressions the fix could have
caused: a press on the title still focuses it, a press on a column header still opens its
menu, Escape still closes it, and the far end of the `+ Add property` label still opens the
add menu. `cdp-db-gutter` **34/34 both widths** (its "no side borders" assertion was updated
to the per-edge rule, not deleted), `cdp-frame-anchor` 9/9, `cdp-db-rowmenu` 34/34.
`artifacts/db-basics-1400.png` and `-390.png`.

**Not re-run:** `cdp-db-menu`, `cdp-db-columns`, `cdp-db-usability` and `cdp-database` create
fixture pages in the live database to assert what they assert. Per `AGENTS.md` that is not
acceptable litter, so they were left alone rather than risk the owner's data; the geometry
they cover is asserted by `cdp-db-gutter` and `cdp-db-basics`, which are read-only by
construction.

**Owner's data:** live 17 / trashed 180 before and after. This run created and deleted
nothing; the only presses it makes are on inert areas, a title, and two menu buttons whose
items it never touches.

### B40h — The button's padding, the row's grey, and the row that came back — **DONE**

Three items, and the first one's own comment was the bug.

**1. `+ New page` was misaligned — the CSS said it was not.** The owner: *"this becomes clear on
hover where you can see the button padding"*. The rule was `padding: 6px 9px` with
`margin-inline-start: -9px`, and the comment above it read: *"the shape extends left of the
grid by nothing and its contents align with it."* Both halves were false. The negative margin
cancelled the padding, so the **shape** began 9px left of the grid while the **contents** began
on it — a highlight hanging out over the page margin on hover. And "contents on the rule" was
the wrong target anyway: a lucide plus at 14px carries ~2.3px of empty box on each side, so the
visible cross landed 2.3px past the rule, and the label at **20px** — while every column title
above and every entry name beside it sits at **29px**.

This block has one left rhythm, and the tab above and the header cell both already follow it:
the *shape* on the grid's edge, the *glyph* on the 10px icon axis, the *words* on the 29px text
column. Measured after the change: shape **502 = table 502**, glyph **512 = header icon 512**,
words **531 = header title 531 = entry name 531**.

**2. The property row's grey is the sidebar's grey.** It was `--palette-gray-text`
(`#c1beb9`) — brighter than anything in the sidebar and the brightest text on the page. It is
`--text-2` (`#a6a29c`) now: the colour `.tree-link` uses for every page row, with the icon
taking `.tree-link svg`'s own `opacity: .75` step back, so a column title reads exactly like a
page in the tree. `+ Add property` shares it.

**3. A restored entry needed a reload — because the table only ever asked once.** A database
block holds one snapshot from `GET /api/databases/:id`; every write *through the block* returns
the next one, so the two agree. Trash is the third caller and it is not the block: the restore
went through `/api/pages/:id/restore`, the sidebar re-read `/api/pages`, and the table — which
had asked at mount — kept showing the gap. The row existed on the server and nowhere on screen.

`src/lib/page-changes.ts`: one signal, one meaning, no payload. `restore` and `onRemoved` in
`workspace.tsx` call `livePagesChanged()`; `useDatabase` subscribes and re-reads. A module-level
subscription rather than a context, because the subscriber lives inside the editor document —
a BlockNote-rendered subtree the workspace never owns. One GET per trash/restore is cheaper
than the bug, and far cheaper than teaching every block which rows it might own.

**Evidence.** `tsc` 0 · unit **395/395** (`tests/page-changes.test.ts`: delivery, unsubscribe,
and a listener that unsubscribes mid-emit) · `scripts/cdp-db-basics.mjs` **38/38 at 1400 and
38/38 at 390** · `scripts/cdp-db-restore.mjs` (new) **11/11** · `cdp-db-gutter` 34/34 and 34/34 ·
`cdp-db-rowmenu` 35/35 and 35/35 · `cdp-frame-anchor` 9/9.

`cdp-db-restore.mjs` writes, and only in data it creates: a scratch page, one `/database`
inside it, two entries, one trashed and restored. It asserts the restore lands **without a
navigation** by setting `window.__b40h` before the press and reading it after — a reload wipes
it. Negating the one line in `livePagesChanged` turns it into 3 failures:

```
FAIL the entry is back in the table, with no refresh — ["e697398d"]
FAIL and the other entry never moved — 1
FAIL it comes back with its cells, not as an empty row — null
```

Two stale assertions were rewritten rather than deleted, because both described behaviour the
owner has since rejected: `cdp-db-basics` asserted the glyph *on* the table's rule and the
header at `--palette-gray-text`, and `cdp-db-rowmenu` still had a `width > 860` branch asserting
that a phone docks the controls *inside* the row — the indent B40g removed on request.

**Owner's data:** live 17 / trashed 180 before, live 17 / trashed 184 after. The four extra are
this run's scratch pages, all titled `zz restore probe (B40h)` — the three that finished were
trashed by their own cleanup, and the one from the run that threw early was trashed by hand
afterwards (`4773c777`). No page of the owner's was touched, and none of their boxes were
ticked.

### B40 — Property rail and the cell kit

**Partly shipped with B38/B39 — audited, and it is thinner than the plan claims:**

| Exists | Still missing |
| --- | --- |
| `POST/PATCH/DELETE /api/databases/:id/properties[/:propertyId]` | reorder; `duplicate` |
| `+` in the header → type menu, grouped, generated from the registry | retype (refuse-or-coerce), hide, filter from the property menu |
| Rename and delete from the header menu (B40b) | one-cell-in-edit-mode keyboard model; Tab/arrow navigation |
| Header menu: rename, icon, Sort A→Z / Z→A (B40b) | multi-sort; sort by a non-primary column is wired but only one sort at a time |
| `CellEditor` dispatching on type | editors beyond `text`/`number` and `checkbox` |

The remaining work in this phase is what makes it a *rail* rather than four buttons:

- **Retype** must be a decision, not a hope: coerce what can be coerced, refuse the rest
  with a reason. It touches stored cells, so it needs the revision bump and a test per
  type pair that is legal.
- **Hide** is view state (`visibleProperties`), never schema. The primary property stays
  visible — `visibleProperties()` already enforces that, and it must keep doing so.
- **Keyboard** is one `editing: {row, property}` piece of state in `TableView`, with
  `Enter` committing and moving down and `Tab` moving right. Without it, adding ten rows
  is ten mouse clicks.

- **Tests:** property CRUD is replay-safe and bumps revision; deleting a property
  deletes its cells and drops it from every view's `visibleProperties`/`filters`;
  retype is refused (or coerced) when stored values cannot be converted.
- **Screenshot:** a four-column table with a Status pill and a Date, in both themes.

### B41 — Row lifecycle ("New page — in the second row of the table")

**Partly shipped:** `POST /api/databases/:id/rows`, row = page, and a control that
creates one and focuses its Name cell.

Still to do, in order of how much they hurt:

- **The trailing row belongs in the table.** It is currently a strip below the table
  rather than a row inside it, so the columns do not line up with the thing you are about
  to type into. Making it a real last `<tr>` also makes "type to create" trivial.
- **Open, icon, delete, duplicate** per row: double-click opens today; the rest needs a
  row menu.
- **Drag-reorder** (`position`), and a row-number gutter to drag from.

- **Tests:** creating a row creates exactly one page and zero cells; a deleted row's
  page lands in trash and restores; reorder is dense and stable.

### B42 — Select, Multi-select, Status (options and colours)

The only place two property types share machinery — `select`/`multiSelect`/`status`
differ by cardinality and by `groupId`, nothing else.

- Tag pills with palette colours from `theme.css` (already mirrored in `tagColors`).
- Option CRUD in the property menu; create-on-the-fly from the cell dropdown
  ("create or select tags in a dropdown").
- Status **groups are editable** — seeded `To-do / In progress / Complete`, then
  ordinary data with add/rename/recolour/remove/reorder. This is the explicit
  difference from Notion and the reason groups are rows rather than an enum.

- **Tests:** deleting an option tombstones cells referencing it rather than leaving
  a dangling id; reordering groups reorders the board columns; a status cell with a
  deleted group falls into the empty bucket.

### B43 — Value semantics and number/date display

- **Number:** formats (`number, separators, currency, percent, duration`), decimal
  places, and the three displays — `number | bar | ring` — with `color`, `divideBy`,
  `showNumber`. All of these are *config only and already in the schema*; this phase
  makes `format` honour them and draws the bar/ring.
- **Date:** end date ("start and end on the same day, 8 hours"), granularity
  (date ↔ date+time), `dateFormats`, `timeFormats`.
- **Files & Media:** reuse the existing content-addressed upload store
  (`data/uploads`, sha256) — a cell stores file ids, not bytes.
- **Person, Created time, Place, URL, Email, Phone, Checkbox, Button:** editor +
  `format`. `Place` stores a freeform address; geocoding is a later server concern.

- **Tests:** number formatting is presentation only (stored value is unchanged —
  there is already a test asserting this for the base case); date ranges round-trip
  timezones; bar/ring `divideBy` never mutates the stored number.

### B44 — Formula

`parse → AST → evaluate`, over other properties' values. No `eval`, ever.

- Dependency graph with cycle detection; a formula referencing a formula resolves in
  topological order.
- Type inference on the result (a formula property is display-only, never editable).
- Errors are values (`#REF!`, `#CYCLE!`, `#DIV/0!`), rendered per cell, never thrown.

- **Tests:** parser (precedence, parens, property refs, numbers, strings), cycle
  detection, div-by-zero, and that a formula reading a deleted property degrades to
  `#REF!` instead of crashing the row.

### B45 — Views

Registry first (4.1), then:

1. **View tabs are data** — create / rename / duplicate / delete / reorder, each
   persisting its own `config`. Filter, sort, group, hide columns, widths, row height
   are all per-view and stored in `database_views.config`, **never in the page
   document** (hiding a column must not create a draft conflict with typing).
2. **Board** — group-by drives columns.
3. **Calendar** — the wishlist's nested `Calendar view`; needs the date type from B43.
4. **List**, **Gallery**.

- **Tests:** per-view config is isolated (filtering one view does not affect another);
  group ordering is stable; a view whose `group.propertyId` was deleted falls back to
  no grouping instead of rendering empty.

---

## 6. Wishlist traceability

Every one of the 30 items, and the phase that closes it. Nothing is unassigned.

| # | Item | Phase |
| --- | --- | --- |
| 1 | Database Table view | B38 (read-only) + B40/B41 (editing) |
| 2 | Properties for all future views | B38 seam, B39 registry, B45 proof |
| 3 | Name (Primary property) | **done** — `pages.title`, id `"title"`, position −1 |
| 4 | Add Property — in table header | B40 |
| 5 | New page — second row of table | B41 |
| 6 | Text | **done** spec, B40 editor |
| 7 | Select (+ colours, dropdown) | B39 spec, B42 UI |
| 8 | Status (+ editable groups) | B39 spec, B42 UI |
| 9 | Person (user) | B39, B43 |
| 10 | Checkbox | B39, B43 |
| 11 | Phone | B39, B43 |
| 12 | Number (+ format, decimals, bar/ring, colour, ÷X, show number) | **spec done** in `configSchemas.number`; format in B43 |
| 13 | Multi-select | B39, B42 |
| 14 | Date (+ end date, format, granularity) | B39, B43 |
| 15 | Calendar view | B45 |
| 16 | Files & Media | B39, B43 (existing upload store) |
| 17 | URL | B39, B43 |
| 18 | Email | B39, B43 |
| 19 | Button | B39, B43 (`actions` already in config) |
| 20 | Formula (takes other properties, does math) | B44 |
| 21 | Created time | B39, B43 |
| 22 | Place/Location (accepts address) | B39, B43 |

---

## 7. Risks and decisions needed

**Decision — `Person` with one user.** `configSchemas.person.limit` defaults to 1 and
the value is stored as a list, so multi-user needs no migration. The picker today
shows the single owner. Confirm that is acceptable until hosting returns.

**Decision — row duplication semantics.** Duplicating a row can either copy a page
body or only cell values. Plan assumes **cells only**, body copied as a page copy
(the existing `page-copy.ts`).

**Risk — `Files & Media` and dedupe.** The upload store is content-addressed by
sha256, so one photo in three cells should be one file. Plan assumes yes.

**Risk — retyping a property.** The schema allows `patchPropertySchema.type`. Retyping
`text → number` on populated cells is a data migration disguised as a dropdown. Plan:
allow, but run values through the new type's `coerce`; refuse with `409` when any
value fails rather than silently nulling it.

**Risk — descending sort inverts "empties last".** `numberProperty.compare` documents
that missing values sort last *in both directions*, but `sortRows` applies direction by
negating the result, so descending puts empty cells first. Every new type mirrors that
`±1` convention, so the bug is consistent rather than divergent. Fix belongs in
`sortRows` (check `spec.isEmpty` before calling `compare`, after B40), not in 16
`compare` implementations — deliberately left alone in B39 because changing shipped
sort order needs its own test.

**Risk — `createdTime` must never be writable.** It is derived from the row's page
`created_at`. `createdTimeProperty.coerce` refuses everything and the spec declares
`readOnly: true`; the write path must honour that flag when B41 adds cell writes, or
the refusal is decorative.

**Out of scope** (not on the wishlist): real-time collaboration, per-cell permissions,
row-level sharing, importing from Notion/CSV, public views, database templates, and
`eval`-based formulas.

---

## 8. Test strategy

The existing suite is the contract, so each phase extends it rather than replacing it.

- **Pure logic gets unit tests** (`rows.ts`, registry specs, formula AST). These are
  the ones that would otherwise rot silently.
- **Service behaviour gets integration tests** against the real migration 6 schema:
  replay-safety, revision conflicts, cross-workspace refusal, cascade on delete.
- **The seam gets a lint-level guard:** a test that walks
  `src/components/database/views/*` and fails if any file imports from
  `lib/database/properties` or `types` other than `formatCell`/wire types. This is
  what keeps views from learning what a type means in six months.
- **Visual QA** at 1400 / 900 / 390 per shell convention once B40 lands.

### The rule this plan learned the hard way

**A phase is not done when its tests pass.** B38's substrate suite was 14/14 and B39's
registry was 30/30 while the block in the browser was a 331px stub with an unlabelled `+`
and no discoverable way to add a row. Every assertion was about the DOM the component
produced, and the DOM was right; nothing asked what it *looked* like or whether a person
could get from "empty database" to "a row with a value in it".

So, for every phase from here:

1. **Drive the thing a user would do**, not the thing the code exposes —
   `scripts/cdp-db-usability.mjs` is the template: add a column, add a row, type, reload,
   assert the value came back.
2. **Take a screenshot and look at it.** `artifacts/db-usable.png` is part of the phase's
   evidence, next to the test count. A measurement beats an opinion, so assert the
   geometry that matters (`blockW === wrapW`, `font-size === 13px`) rather than trusting
   the CSS to have won the cascade.
3. **Only then** is a phase done.

