# Why the code is like this

`AGENTS.md` says what to do. `docs/MAP.md` says where things are. This file says **why**,
so that the reasoning survives without occupying the file that is injected every session.

Every entry here was paid for with a bug, a measurement, or a sentence from the owner.
Do not "clean up" one of these constraints without knowing which of those it cost.

---

## Reuse, and why "close enough" is the failure mode

The owner has caught the same mistake twice, which is what makes this the first entry.

The database's row gutter needed a six-dot grip and a plus. The editor already had both —
path-for-path copies of BlockNote's own — but they were private to
`components/editor/object-menu.tsx`. So the gutter was written with lucide's
`GripVertical` and `Plus`. Same names, same purpose, visibly different shape: lucide's
dots are hairlines, the established ones are filled.

> *"You did not re-use the 6 dot grip and plus components that are already established …
> Why are you constantly redoing them instead of using what is already established."*

**A near-miss is worse than a clear difference.** Two grips that are *almost* the same
read as two unrelated controls, and the eye catches it immediately even when it cannot
name it.

### Reuse the component, not its numbers

Reusing the glyph but hand-rolling the button is the same mistake one level down. The
established pair is a **19.5×30** button holding an **18×22** glyph,
`border-radius: var(--radius-sm)`, `color: var(--text-3)`,
`background: var(--hover-strong)` on hover — `.frame-grip` in
`src/app/editor-blocks.css`.

`FrameAnchor` renders the box, both buttons, the order, the labels and the hover. Its host
may decide only *where it sits* (`inline` versus floating) via `.frame-anchor--inline`. If
a new host wants a different colour, size or hover, it does not have a new host — it has a
new component, and that is a decision for the owner, not a line to type into a stylesheet.

### Order counts

`FrameAnchor` renders the plus **before** the grip. A second gutter that renders
grip-then-plus is the same two glyphs mirrored: correct in isolation, wrong beside the
first one. When you reuse a pair, reuse its arrangement.

### The escape hatch is "move it up", never "copy it down"

B42c needed a grip with **no plus beside it** — a drag handle in each row of the tag menu.
There was no such control to import, so the two obvious moves were both wrong:

- draw the dots again in the tag menu → the row gutter's mistake, one level down;
- import `GripGlyph` into a third file → the pin in `tests/frame-anchor.test.ts` fails, by
  design, and the *reason* it fails is that a bare glyph is not a control: the button brings
  the `mousedown` that stops a press becoming a text selection, the `is-open`/aria pairing,
  and the pointer-handler seam a drag needs. A copy of the dots with a hand-rolled button
  would have been correct-looking and wrong in three ways nobody photographs.

So the button moved **down** into `grip-glyphs.tsx` as `GripButton`, `FrameAnchor` began
rendering it for its grip half, and the two hosts now differ by one class: `extraClass`.
`.frame-grip` is the base — the pair's 19.5×15 half — and `.db-option-grip` is a *modifier*
on it, a menu row's 16×20 handle. Same glyph, same press semantics, same transition, same
hover lift, same `(hover: none)` visibility; only the box differs — which is the only reading
of "the same control at a different size" that survives contact with a second host.

That last part was paid for inside the same session. The first version of `GripButton` took
a `baseClass` that *replaced* `frame-grip`, and the handle silently lost the shared
transition, the hover colour lift and its appearance on a touch screen. `.db-grip` — the
existing gutter modifier — had already established the right shape: a modifier is added
*alongside* the base class, never instead of it. `tests/database-options.test.ts` now asserts
that the base class never leaves the shared rule.

The pin got *stronger* as a result: `GripGlyph` is now named in exactly one file, the file
that defines it, instead of two. Widening a guard's file list is only acceptable when the
control it guards has moved to a narrower place — and the list of glyph *consumers* is still
enumerated one by one in the test, because a new consumer is a new decision.

The operational table of shared controls is `docs/MAP.md` § "Shared controls".

## The guard is a test, not a note

> A note in a document is only followed by whoever read it that session; a failing test is
> read by everyone.

`tests/frame-anchor.test.ts` fails if a second file renders `.frame-anchor`, imports the
glyphs, re-declares the pair's CSS, or reintroduces the removed `.db-pair` / `.db-plus`
classes. `tests/docs-freshness.test.ts` fails if `docs/STATE.md`'s numbers stop matching
reality.

This is the repository's answer to every "remember to…" instruction, and it is the reason
this documentation refactor is expected to hold: the parts that matter are asserted.

## CSS: specificity collisions are this repo's most expensive bug class

Every rule here was found by measuring, not by reading.

- **`.bn-editor table` sets `overflow: hidden` at `(0,1,1)`**, which beats a plain
  `.db-table` class rule. Anything positioned outside a table's own box is painted into
  nothing until the table stops clipping. The same trap exists in the type scale.
- **A `td` is `.db-cell`, and `.db-cell` clips for truncation.** A cell that only holds an
  overhanging control needs `overflow: visible` of its own.
- **Correct DOM, correct opacity, correct geometry, zero pixels is a real failure state.**
  Assert with `elementFromPoint`, not `getBoundingClientRect` — an element can have a
  perfect rectangle and still be painted into a clipped ancestor.

Load order lives in `layout.tsx`. One CSS file per surface; a rule belongs in the file that
owns the surface, not in `globals.css`.

## A drag is `DragLayer`, not a new ghost

A dragged row and a dragged page must read as the same gesture, so the database table
renders `components/drag-layer.tsx`: the ghost under the cursor (`.tree-ghost`, 0.86
opacity, portalled and `position: fixed` so an `overflow: auto` ancestor cannot clip it)
and the insertion line (`.tree-drop-line`).

Drawing a second ghost with its own opacity and its own shadow is the same class of mistake
as drawing a second grip. The two are only ever seen side by side in a review, and the
difference is exactly what the owner notices.

## The dev server caches service *instances*, not classes

`src/server/runtime.ts` memoises `RaspberryService`, `DatabaseService` and `FileStore` on
**`globalThis`**, not on the module. The placement is the whole point: state on the module
would be discarded when the module is re-evaluated, but `globalThis` outlives the module
graph, so the instance **survives** a hot reload while the class it was built from does not.
Editing a service class re-evaluates the class and leaves the old instance in place, so a
method added a minute ago answers `is not a function` and the route returns **500** — which
looks exactly like a bug in the new method you just wrote.

Restart `Start-Raspberry.cmd` after adding a server method, before believing any 500. This
has cost more debugging time than any other single cause in this repo.

*Correction, recorded because two documents and a code comment all explained this backwards:
the earlier version of this entry said the instances were memoised "on the module" and that
the reload *cleared* them. Wrong on both counts — and the wrong version is more dangerous,
because "the reload clears it" tells you the stale instance is impossible right before you
spend an hour debugging your own new method.*

## A gap between a menu and its submenu is not a `mouseleave`

`MenuSub` used to close on the wrapper's `mouseleave`, and the comment defending it was
*true*: the surface is a portal, but it is a React child of the row, and React's enter/leave
tracking walks the React tree, so crossing from the row into the surface is not a leave. That
answer is about a crossing that lands **on** the surface. The pointer does not land on it — it
travels through the `GAP` (6px) between the row's edge and the surface, and that strip is
neither box. The topmost element there is the parent `.db-menu`, an *ancestor*, which React
reads as a leave. The surface unmounts mid-crossing.

The failure is a coin-flip that reads as randomness: a fast flick sends one pointer sample that
lands past the strip, a deliberate move sends one *inside* it. Hence "70% of the time".

Three lessons, all paid for here:

1. **"It is a React child" answers the wrong question.** The portal is a React child of the row.
   The 6px strip is not part of either box. A claim about the tree does not settle a claim about
   pixels — check where the pointer actually is (`document.elementFromPoint` in the strip says
   `div.db-menu.db-prop-menu`).
2. **A probe that steps over the bug proves nothing.** `verify-db-number.mjs` crossed the gap in
   four hops and passed on the broken code, because its *first* hop already landed past the 6px.
   Motion has to be sampled at the resolution of the thing being crossed: one pixel per step, and
   a dwell. `scripts/verify-db-submenu-hover.mjs` is that probe.
3. **A close timer is the wrong fix here.** The obvious repair — delay the close by 200 ms and
   cancel it if the pointer arrives — shows **two** submenus at once whenever the pointer moves
   to a sibling row inside that window, and the thing it delays is the one transition that has to
   be instant. What the code does instead is positional: while a submenu is open it closes on the
   first pointer move that is on neither its row, its surface, nor the strip between them. The
   strip is a corridor a crossing pointer is inside by definition; every row ends at the row's
   right edge, so a sibling row is not — and the corridor's vertical span is both boxes together,
   which also covers a diagonal approach to the top of a tall surface.

The general shape: when two floating boxes are meant to be a single hover target, their union —
gap included — is the hit region, and any handler that treats the gap as "outside" is wrong by
geometry, not by degree.

## The corridor covers a horizontal crossing; a diagonal is its own decision

The corridor above is a rectangle in the gap, and it solves the crossing it was drawn for: the
hand goes right, the pointer is in the gap, it arrives. It says nothing about the gesture people
actually make for the **second and third items of a submenu** — right *and* down at once. That
line leaves the row's 32px band roughly 50px out, while the parent is still ~60px wide, so the
pointer is in the parent's other rows with the corridor nowhere near it, and "not on the row"
closed the surface. Measured, not reasoned: it failed on the first attempt, at both widths.

Two fixes were available and one of them is the reason this section exists.

**The rejected one: delay the close.** 200ms and cancel on arrival. It would work for a diagonal,
and it re-opens the thing the corridor was built to avoid — a window in which two submenus are
visible at once, on the transition that has to be instant. It also makes the menu's timing depend
on a number nobody can defend: 150? 250? Every value is wrong for some hand.

**The one taken: a safe triangle, plus one owner.** While the pointer is inside the triangle
between where it last was **on the row** and the surface's near edge, nothing dismisses it. That is
geometry again, and it is the shape Amazon's menus have had since the 90s precisely because it is
what a reaching hand traces. Crucially it is gated on **direction of travel**: the pointer must be
moving toward the surface's edge. Without that gate, "hover a plain sibling row closes the
submenu" stops being true — the triangle overlaps neighbouring rows — and the owner would have
traded one disappearing surface for a surface that will not leave.

The overlap is real, so sibling *exchange* cannot rely on "the old one closed already": the row
that opens last now closes the one before it, through a module-scoped `activeSub`. One surface
exists at any moment, in either direction, and swapping is still instantaneous — the timer is
avoided without reintroducing two surfaces.

The general shape, and it is the same lesson one dimension over: **a hit region is a shape, not an
event.** `mouseleave` gave a wrong shape, the corridor gave a right shape for one dimension, and
the triangle supplies the missing one. When a menu's job is to be *reached*, the test is not
"did something leave" but "is this point on the way".

## A `MenuSurface` places a surface; it does not close one

`MenuSurface` computes where a menu goes and portals it. It registers **no** dismissal
listener — not the outside press, not Escape. Every menu in the app that works is
`MenuSurface` *plus* `useMenuDismiss(open, onClose)` called by the caller, and that pairing
lives in the caller's file, where nothing forces you to notice it.

The tag panel was written from the primitive alone. It rendered, placed, hovered, and
clicked perfectly — and could not be closed. The symptom was not "the menu is stuck": it was
"the click did nothing", because the press landed on the panel (which is a fixed-position
surface over the table) instead of the cell behind it, and then the *next* interaction was
against a menu that was still open. A day went into blaming the probe.

Two things follow, and both are now enforced rather than written down:

- **A primitive that is never used alone should not be *usable* alone.** The real fix here
  was smaller than the diagnosis: `tests/database-options.test.ts` reads the file and fails
  if `useMenuDismiss` disappears from it. A note would be read once by whoever happened to
  open `menu.tsx`; the test is read by everyone, every run.
- **When a click "does nothing", check what is on top of the thing you clicked.** The probe
  now asserts that the point it is about to press resolves — through `elementFromPoint` — to
  the cell it named, and it names the mismatch when it does not. That single assertion turned
  three separate wrong theories into one line of evidence.

## Two shapes of "a Select cell", and the one the helper assumed

`select` and `status` store one option **id, as a bare string**. `multiSelect` stores a list.
`optionIdsOf` ran its input through `asList`, which answers `[]` for anything that is not an
array — so for two of the three types it answered "nothing selected", always.

What makes this one worth recording is that it was *invisible from every angle you would
naturally check*. The server stored the right id. The read-only table rendered the right name
(it formats through `asText`). The panel listed the options. Only the editable cell was blank,
and a blank cell in an empty column looks exactly like a cell with nothing in it. No test
covered it because the native `<select>` "worked" — it just never showed what was selected.

The general shape: **a helper named "ids of" must accept every shape its callers store**, and
two of three callers were wrong while the tests were green. `tests/database-options.test.ts`
now asserts the bare string, the list, the empty cell and the dangling id separately.

## "A → Z" and "the order I dragged them into" are two orders, and one field held both

For Select, Multi-select and Status, `compare` answered with the option's index in the property's
config — the arrangement — while the menu labelled that comparison **"A → Z"**. So the request
"add the option to sort them the way I arranged them" was asking for something that already
happened, under a name that said otherwise. Adding a second menu row with the same behaviour as
the first would have been worse than either fix.

Two things made the honest version cheap:

1. **The direction vocabulary lives in the schema, not the component.** `sortSchema.direction` is
   what a view persists, so a third value is one edit there and the type flows to the menu, the
   header and `nextSorts`. A direction invented in the header would be a `PATCH` that fails on
   click — the same class of lie as the label.
2. **A type says whether it has an arrangement.** `PropertyTypeSpec.order` is optional; Select,
   Multi-select and Status implement it, nothing else does. The menu renders the row from the
   *presence of the label* (`sortLabels(...).manual`), never from a list of type names, and
   `sortRows` falls back to `compare` when a stored config asks a column for an order it does not
   have. A direction is a string in a JSON column; an unknown one must never mean "unsorted".

The cost was two guard tests that encoded the old meaning. They were *correct* about the old
design, so they were rewritten against `order` — and each now asserts `compare` gives the
**opposite** answer on the same fixture, because a tag column whose options happen to be
alphabetical cannot tell the two apart, and that is exactly how the original label survived.

Checked before changing the meaning of a stored field: no view in the owner's database sorts by an
option property, so nothing reordered for him. That check is the difference between a fix and an
ambush.

## A memo on `globalThis` must remember what built it

The third sort direction was on disk, in the recompiled route, in `tsc`, in 456 passing tests, and in
two browser probes that passed 21/21 each — and the app still answered
`Invalid option: expected one of "ascending"|"descending"` when he clicked the new row. The message
was written by `sortSchema` from an hour earlier: the dev server had been running since before the
edit, and its parked `DatabaseService` instance was still calling the module graph that built it.

**A probe starts a new process, and a new process evaluates the current modules. So a green probe
proves the source — never the process the owner is looking at.** Those are the same process only
after a restart. `AGENTS.md` said as much ("restart after adding a server method") and it was not
done, because nothing about the flow *looked* stale. That is the whole failure mode: staleness has
no symptom until a new value reaches an old validator, and then the bug appears in the newest code
in the app.

The memo cannot go away — a connection and its migrations must outlive a reload — but only the
*connection* needs that. Both service classes are `constructor(private readonly database: Database)`
and nothing else, so an instance is one allocation, and the useful life of an instance is exactly
the life of the class that built it. So the parked promise carries `from`, the class it came from,
and `reused()` rebuilds when that is not the current class. Editing `types.ts` invalidates
`databases.ts` and re-evaluates the class, which is exactly when the stored instance became a
liability rather than a saving.

What that buys, measured on the running server, same request, nothing written: before
`"ascending"|"descending"`, after `"ascending"|"descending"|"manual"`. No restart.

Three claims were false and are now corrected rather than re-explained: that editing `runtime.ts`
clears the memo (`state` is `globalThis`; nothing clears it), that the instance is "memoised on the
module" (`MAP.md` had already caught that one), and that a restart is the only cure. `??=` on a
global slot is a memo that can never notice a replaced class, so `tests/runtime-memo.test.ts`
forbids it instead of describing it.

## A floating panel must be clamped to the room it has, not to a guess

`menuStyle`'s `side: "right"` branch reserved a flat **120px** for the submenu's height, a
number that was right for every submenu that existed when it was written. The tag colour list
is 408px. On a 1378×802 viewport the panel started at 571 and ran to 979 — the lower 177px,
including the last four colours, sat below the fold.

Nothing looks broken. The menu opens, the top of it is visible, and the rows that are off the
bottom simply do not respond, because `document.elementFromPoint` at a coordinate outside the
viewport returns `null` and the pointer event goes nowhere. The probe reported
`elementFromPoint: "nothing"` at the exact centre of the "Blue" row it had just measured.

The fix is to clamp `maxHeight` to `innerHeight - EDGE - top` and let the panel scroll, with a
160px floor that lifts the panel off its row when that is all the room there is. And the
measurement inside the probe now scrolls a surface before it aims at a row inside it — which
is what a person does with a menu that is taller than the window.

The general shape, twice paid for now (see `B40m` above): **a requested window size is not the
viewport**, and a point outside the viewport is not a click that failed — it is a click that
was never delivered.

## A box that clips must not inherit a tight line box

`.db-tag-name` carries an ellipsis, so it clips. It inherited `line-height: 1` from `.db-tag`,
so its content box was exactly one font-size tall — 13px, for a font whose ascent plus descent
is 15px. The bottom 1.5px of g, j, p, q, y and the comma was inside the clip. The owner saw it
in a screenshot and guessed the rest of the alphabet: *"I suppose similar letters will have the
same bug."*

Three things about this one are worth more than the fix.

**Nothing in the DOM could report it.** `scrollHeight === clientHeight` throughout, because ink
overflow is not scrollable overflow — the standard "is it overflowing?" check answers *no* on a
clipped descender. So the measurement has to be font metrics against the clip box:
`fontBoundingBox*` for the line box, `actualBoundingBox*` for the ink of that exact string.
`scripts/verify-text-clip.mjs` does that for every clipping element on the page and says how
many it examined, because a sweep that measured nothing must not read as a clean sweep.

**The first version of that probe was silently wrong in the same direction as the bug.** It
counted lines from a `Range` rect and skipped anything it read as multiline — and for inline
content Chrome returns the *font's* text box (≈16px), not the 13px line box, so all five chips
were skipped and the probe printed a clean bill of health. It was only believed after it was
made to fail on the un-fixed CSS. The lesson is the one in § *The guard is a test, not a note*,
sharpened: **a passing probe must be shown failing before it is trusted.**

**The fix is a line-height, not `overflow: visible`.** Deleting the clip stops the cut and
starts a long name painting outside its chip. The name declares `line-height: 1.4` instead;
because the chip is a fixed 20px with centred line boxes, the baseline works out to
`(20 − ascent − descent) / 2 + ascent` whatever the line box is, so the chips did not move
(measured: still 20.00px). `normal` would have sufficed — by definition it contains
ascent+descent — but with zero slack, and the fallback fonts are taller than Inter.

`tests/text-clip.test.ts` holds the line: it resolves the chip's effective line-height through
inheritance (the part a CSS text scan cannot see), insists the clip and the ellipsis stay, and
forbids the shape anywhere else — a rule that clips *and* declares a line box under 1.15em.

## A label that restates the layout is furniture

The Status-groups pane carried a micro-caps heading over its list: **Groups, top to bottom**.
The owner's reply was two lines long and both were the point: *"Really? 'Groups, top to bottom'
? ... Whats this fluff text ... are you even using the apple-design and emil-design skill that
you have access to?"*

It was wrong twice, and the second time is the expensive one.

**It said what the shape already said.** A vertical list is top to bottom. The heading spent
`6 + 11 + 4 = 21px` — the tallest thing in a 252px menu — to name its own layout. Apple's
*simplicity* is not minimalism: a label earns its place by removing a question, and this one
removed none.

**It promised an ordering nobody could make.** Group rows have no grip; the only reorderable
list in that menu is the tag list, and that grip was added two turns earlier. So the sentence
told the owner an order existed and was theirs to set, in a pane where it was not. A label that
describes a capability you did not build is worse than a missing label, because it is
indistinguishable from a broken control — which is the same failure as the turn before it,
where four group controls existed in one surface and were described in the words of the other.

The fix deletes it and keeps the space: `.db-groups-list { padding: 2px 0 1px }`. The first row
now sits 6px under the divider — menu rhythm, not paragraph rhythm.

Two more pieces of the same surface came out with it, and neither was decoration:

- **The back arrow wore the icon *well*.** `.db-prop-icon-btn` is a bordered 28px box. That is
  right in the property menu's head, where it holds the column's icon next to a text field — two
  inputs, side by side. In a pane head it put a box inside a box, beside a bare `+` on every row:
  two shapes for one kind of control, a small icon you press. It gained `.db-menu-back` as a
  **modifier alongside the base class**, the way `.db-grip` does, so the shared size, radius and
  hover lift survive and only the chrome goes.
- **The head had no CSS at all.** A block parent, an inline-flex button and a span. The arrow and
  the title lined up on whatever baseline the JSX whitespace happened to produce — it looked
  fine, which is exactly why nobody had written the two lines that make it true. It is a flex row
  now, with `.db-prop-head`'s own `2px 2px 4px`, so swapping the menu's body for this pane does not
  move the head by a pixel.

**What was actually missing was a way to look.** Every guard in this repo is an assertion, and no
assertion can answer "does this look made on purpose". `run-groups-shot.ps1` photographs the pane
at both widths and `scripts/scratch/crop.mjs` enlarges a 28px control 3×; the heading was obvious
at 3× and invisible in the summary I had written instead. Screenshots are the evidence for craft
the same way a probe is the evidence for behaviour.

## Database: the decisions the plan left open, and how the code settled them

`docs/ARCHIVE/DATABASE_PLAN.md` § 7 listed what needed deciding. Where code has since
answered, the answer is recorded here so it is not re-opened by accident:

| Question | Settled as | Where |
|---|---|---|
| Does a view store a filter/sort *spec* or a compiled query? | A spec, interpreted purely each render. | `src/lib/database/types.ts`, `rows.ts` |
| Are rows pages, or their own table? | **Rows are pages.** No row table exists. | `src/server/databases.ts` |
| How is a cell write made idempotent? | Receipt envelope: every mutation carries an id, replaying it returns the stored result. | `src/server/databases.ts` |
| Where do formulas evaluate? | Server-side, pure, **never `eval`** — a parsed AST walked by the evaluator. | B44, not yet built |
| What does an empty value sort as? | Last, in **both** directions. Enforced in `sortRows`, which decides emptiness *before* applying the direction — negating a comparator also negates its promise, which is how `Z → A` used to float blanks to the top. | `src/lib/database/rows.ts` |
| Does retyping a property with data coerce or refuse? | **Coerce, and refuse only what it cannot read.** One rule: read the old cell through the new type's own `coerce`. Unreadable cells are counted and the change is refused with that count; `clearUnconvertible: true` is the caller saying "clear them". A curated allow-list of text-reading targets rather than 16×16 conversions, because reading a date's *rendered label* back as a date shifts days across timezones. | `src/lib/database/convert.ts`, `src/server/databases.ts` |
| Who decides a property cannot be written? | The type module, and the write path reads it. `readOnly`/`derived` used to be documentation only — a formula column accepted typed values. Now `patchRow` refuses per cell, before any write. | `src/lib/database/property-types/*.ts`, `src/server/databases.ts` |
| Where does a "this will lose data" count live? | In the **label** of the destructive menu item, not in `hint`. `MenuItem`'s `hint` renders as a `title` tooltip, and a count that only appears on hover is not there when the person is deciding. | `src/components/database/property-header.tsx` |
| How does the client know *how many* cells a refusal would clear? | `AppError` carries optional `details`, the envelope forwards it, and `RequestError` keeps it. Without the number the client can only print a sentence and hope. | `src/server/service.ts`, `src/server/http.ts`, `src/lib/api-client.ts` |
| Where does the "new page" affordance live? | As the table's **last `<tr>`**, built from the same gutter / name-cell / icon-slot / `+` cells as a real row. The measured proof: the placeholder's left edge equals a real name's (520px) at 1400 and 390. A button beside the table is a different kind of action with its own alignment to argue about. | `src/components/database/table-view.tsx` |
| What does Enter do in a cell? | Moves down the same column (and commits, because moving focus *is* the save). Tab stays the browser's, since every editable cell is a real field. Written against the DOM, not the row-set, so it moves through the table that is on screen. | `src/lib/database/cell-nav.ts` |

The last six rows were settled on 30 October, all of them by a probe that disagreed with the
prose rather than by reading the code again. Two of those disagreements are worth keeping:

- **`MenuItem`'s `hint` is a tooltip.** The "clears 2 cells" count was written into `hint`
  first, and it existed on screen only while hovering. A destructive confirmation whose number
  is invisible is not a confirmation.
- **A copy of the app is not the app unless the project directory is the copy.** `next dev`
  resolves its project from its own working directory, so a server started "from the copy"
  through a wrapper could serve the *repo* while the probe hunted for the copy's page — and it
  looked like the feature was broken. `run-b40-probe.ps1` now invokes `next` directly with
  `-WorkingDirectory` set to the copy.

---

## A default nobody wrote is a *reading*, not a migration

When Status groups became editable (B42f), the owner's live column already had
`groups: []` — and so does every status column created before the feature. There were two
ways to make it draw three sections:

1. write the three groups into the config on first open (or in a migration), then read them;
2. read an empty array *as* the three defaults, and write nothing until the owner edits.

The first is the obvious one, and it is wrong for two reasons that are not about status:

- **Opening a menu is not a wish.** The rule this repo runs on is that a read must not
  touch the owner's data. A panel that migrates on open makes every accidental click a
  write, and makes "did I change something?" unanswerable.
- **A migration has one moment to be right.** If the defaults are also a fallback, a column
  that somehow loses its groups still draws sensibly. If the defaults only ever existed in
  a migration, a `groups: []` that arrives by any other route (an import, a hand-edited
  row, a `clearUnconvertible`) is a column with no sections at all.

The price of the reading is that two functions have to be kept apart: `groupsOf` (what to
draw) and `storedGroups` (what a write carries). Merging them breaks both halves at once —
`groupsOf` used as a write would silently plant defaults into a column nobody edited, and
`storedGroups` used as a read would draw zero sections on the owner's column, which is the
bug the feature exists to fix. The same reasoning produced `groupIdOf`: a tag whose
`groupId` is null or names a deleted group belongs to the **first** group, so that
"every tag is in exactly one group" is true of the raw data too, not only of the UI.

Which is also why the default ids are constants (`grp-todo`, `grp-in-progress`,
`grp-complete`) rather than random ones. `create` in the cell dropdown writes a `groupId`
the moment a tag is made — possibly before any group has ever been stored — and the first
group write has to store the ids the panel was already drawing, or the tag created one
minute earlier would point at nothing.

## Deleting a tag is a config write, so its cells are pruned in the same transaction

A tag is not a row in a table: it is an entry in the property's `config.options`, and a cell
stores its **id**. So "delete the tag" is a config write — and the moment it commits, every
cell that stored that id is pointing at nothing.

Before B42f the only cleanup was the one cell the menu happened to have open (`remove()` in
`option-panel.tsx`), which meant a tag deleted from one row silently left the same tag
rendering as an empty chip in every other row. It looked like a rendering glitch and was
actually a dangling reference.

`patchProperty` now prunes, after writing the config and inside the same transaction: any
cell holding an id the new config no longer contains is rewritten without it, and deleted
when nothing is left. Three things about that are deliberate:

- **It is not a status rule.** It runs for `select`, `multiSelect` and `status` — group
  deletion is just the loudest case. A fix scoped to groups would have left the older,
  quieter bug in place.
- **It is not a client rule.** The client cannot see other rows, and a probe cannot trust a
  client that says it did. `scripts/verify-db-status-groups.mjs` reads the cleared cell back
  from `/api/databases/:id`.
- **It is why a status config write must carry both lists.** The server validates the whole
  object it is handed (`configSchemas.status`), so `{ options }` alone erases the groups and
  `{ groups }` alone erases every tag. Both call sites are pinned by a test, because this is
  the kind of omission that only shows up as "my tags disappeared".

## One control, or two that must be kept in step

B42f put the group editor in the property menu. The owner then said it did not exist:

> *"You said there's a + on the group ... there isnt. Clicking on a group name expands it ...
> it doesnt. There is no way to add a group. There is no way to remove a group."*

All four were true of the **tag dropdown**, where a group heading was a `<div>`. Nothing about
the pane was broken; it was simply not the place the owner was standing. The temptation is to
copy the four controls into the dropdown and be done in an hour. That is the third time this
project would have paid for the same mistake (the grip, then the plus, then this), so the
decision is the other one: **the row, its panel and the New-group block are one component**
(`group-controls.tsx`) and both surfaces render it. A `variant` changes the heading's size and
nothing else. If a control is added to a group it is added once, and there is no second copy to
forget.

Three consequences worth keeping:

- **A default that only exists as a reading has two call sites that must not invent their own.**
  `groupsOf` (what is drawn) and `storedGroups` (what a write carries) live in the lib, so the
  shared editor cannot re-derive them differently from the dropdown that lists the sections.
- **The surface decides what "create" means, not the editor.** `+` on a group adds a tag; in a
  *cell* dropdown it also selects it, because that is why you pressed it. That is a callback
  (`onCreated`), so the pane still only adds.
- **Ordering is a correctness property, not a detail.** Creating a tag from the dropdown is two
  writes, and the config must land first: `coerce` empties a cell that names an option the
  config does not have yet. Written as `void onConfig(...)` it raced — and lost at 1400px while
  winning at 390px, which is the worst kind of bug to be told about. `await` before
  `onCreated`, and assert at both widths.

## A click is not a `click()` — and my browser tool fires two

Chasing this bug, two measurements said the group name was dead. Both were artefacts:

- `browser_use` dispatches **two** `click` events for one press, so a row that toggles opened and
  immediately shut. The recorded event log showed `pointerdown … click … click` on the same
  button.
- My first standalone diagnostic then sent *two* presses of its own (a leftover "settle" move
  that was itself a full press/release).

The app was fine both times. The only click this repo should trust is `b.mouse()` in
`scripts/browser-session.mjs`: one `mouseMoved`, one `mousePressed`, one `mouseReleased`. When a
click "does nothing", count the clicks before you read the handler — and if a probe says a
control is dead, make it fail on the un-fixed code first, or it is not evidence.

## A surface that knows how tall it is must not be cut in half

`menuStyle` flips a surface above its anchor only when the room below is under `MIN_BELOW`
(220px), because a *menu* is height-clamped: it scrolls, and a scrolled menu with a few rows under
the fold is still a menu. The date picker is not that. It is ~380px, a calendar losing its last two
weeks is losing the tool, and the `End date` / `Include time` rows live at the bottom — so at
1400×900, opened from a row near the bottom of the table, it was clamped to the 355px that
remained and rendered *scrolled*, with the second toggle invisible.

Every assertion passed. The panel was in the viewport, the surface was one element, the toggles
were in the DOM and pressable by `elementFromPoint` after a scroll. It was found by opening the
screenshot and looking at it.

So the primitive learned one optional fact: `preferHeight` — "this surface wants this much room".
Below that, it flips. Omitted, nothing changes for the menus that scroll by design. The lesson is
narrower than "always look at screenshots" (which is already this repo's rule) and more useful:
**a rule that treats every surface as a scrolling menu will quietly mis-serve the one surface that
is a calendar** — and the mis-service is invisible to assertions about presence, because everything
is present.
