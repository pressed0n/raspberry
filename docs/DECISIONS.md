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

**The same shape, in a second place.** The page title is a `rows=1` textarea with
`overflow: hidden` and `--lh-tight`: at 40px the serif's box is ~50px inside a 47.2px line, so
the tail of a "p" sat under the padding edge. It was found only when the dates runner's
text-clip step finally ran — it had been waiting for a tag chip on a fixture that has no tags,
so the step had never once measured anything and the runner had been failing after its real
probe passed. `padding-bottom: 0.06em` is the fix, in `em` so it scales with `--fs-title`
instead of being right at one breakpoint. A clip box elsewhere in the app inherits this
question, not just this answer.

## The sample in a trailing slot sets the width of the whole menu

The property menu's `Date format` row reported the current rendering — `2026-10-30`, then
`30 Oct 2026`, and with this turn's formats it would have been `October 27, 2026`, 110px of it.
Add an icon, a label, a caret and 16px of padding and that single row fixed the menu at 268px.
The stylesheet said `252px` all along and never won, because `MenuSurface` writes the width
inline; the tag dropdown passed 272 and the calendar 296, so the family had four widths in
three files and the widest box in the app was a *cell* menu.

Three things, and the third is the one that generalises.

**The tick already answers the question.** The submenu marks the running format one level
down; a name in the trailing slot repeats it. What a *sample* would add — what this format
looks like — cannot be compared across six rows you never see at once.

**Samples stay where they are the content.** The number menu keeps them, because "1,234.5"
and "1,234.50" *are* the difference between one decimal and two. A date format's difference is
a shape, not a number, and a shape is read by choosing it.

**A family of surfaces needs one number, not one per surface.** `MENU_WIDTH = 252` and
`SUBMENU_WIDTH = 200`, both in `menu.tsx`, with the stylesheet rules that duplicated them
deleted. A width written twice is a width that can disagree with itself, and nothing reports
the disagreement — the menu simply laid itself out at 268 over a 252 rule for two turns. The
guard is in `verify-db-dates.mjs`: it measures 252 for the menu and the picker, and fails if
any row truncates its own name, because a menu narrow enough to cut "Date format" short is a
smaller box lying about what is in it.

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

## The owner overruled the pane: a fly-out, and the two numbers that make it fit

This shipped as a body swap, with an argument that read well: at 390px the picker is already 252
wide, so a 200px surface flying out to its side has two options — off the right edge, or on top of
the calendar it is describing. The arithmetic is real. It was also not mine to settle with: the
owner opened it, saw the calendar vanish, and said *"those options should open next to the
dropdown"*. A correct-in-theory substitute for the thing someone asked for is still a substitute.

So `Date format` is a fly-out now, rendered by the app's one submenu (`MenuSub`): the same
primitive as `Sort`, `Decimal places` and the tag colours, with the same hover corridor, the same
Escape, the same flip. Reusing it was not decoration — the pane was a second implementation of
"there is more behind this word", and a second implementation of "submenu" is exactly how two
gestures drift apart.

Two things it needed, both found by measuring rather than by reasoning:

1. **The list was squeezed, not placed.** At 1400x900 the row is the last of a 370px panel, so
   `menuStyle`'s side rule — which tracks `anchor.top` and reserves 120px — left the surface
   164px of window and drew five of its nine rows, the two clocks under a fold. A caller that now
   states `preferHeight` hangs the surface from the row's *bottom* edge and grows upward: all
   nine rows, ending on the row it belongs to. Submenus that state nothing keep the old
   placement, which their probes measure, because changing both would be a redesign wearing a
   fix's clothes.
2. **390 is still arithmetic.** 252 + 200 does not fit in 390, so at that width the fly-out flips
   to the left and lies over part of the calendar — the tag-colour submenu's behaviour since it
   shipped, and now asserted at both widths instead of hoped for: *"at this width there is no room
   beside it, so it flips and stays wholly inside the viewport"*. The difference from the pane is
   that nothing *disappears*: one pointer move dismisses the list, and the calendar behind it was
   never unmounted.

What survives from the pane, and still holds for `Status groups`:

- A pick keeps the surface open — the person is mid-value, and the acknowledgement is the bound
  row above the grid re-rendering in the new format.
- **A pane removes the row that had focus.** `document.activeElement` falls to `<body>`, which is
  outside the surface, and `onMenuKeys` — bound to the surface element — never hears another
  press: the pane is a pointer-only room from the instant it opens, and every assertion about
  *presence* still passes. That is why `Status groups` had been keyboard-dead since it shipped.
  The fix belongs to the primitive — `autoFocus` on the head's back button going in,
  `focusMenuRow(key)` on a row carrying `focusKey={key}` coming back. A fly-out needs neither,
  because the row that opened it is still there; `tests/database-dates.test.ts` asserts this file
  has neither half, so a body swap reintroduced here has to bring them with it.

## A control that changes position when it changes value

The owner, twice in two lines: *"It's not vertically in the center of the cell. an unchecked
checkbox has a different position than the checked checkbox."* One cause, and it was not a
missing margin.

The tick was an `inline-grid` rendered straight into the `<td>`, so it was a participant in the
cell's **line box** — and it inherited two separate problems from that.

1. The cell is `vertical-align: top`, so the line box starts at the top: 4px above the box, 12px
   below it. Nothing was centring it, because nothing could — an inline-level box is placed by a
   baseline, not by a container.
2. An `inline-grid`'s baseline is *the baseline of its contents*. Empty, that is the bottom
   margin edge. Holding a `✓`, it is the glyph's own baseline, about 11px in. So adding a value
   moved the same element 2.5px down. The control was in two positions depending on its data,
   which is the one thing a checkbox must never do.

The fix is not a nudge; it is taking the tick out of the line box. It renders inside
`.db-check-cell`, a flex row with `height: 100%` and `align-items: center`. As a flex item the
box is blockified — no baseline can reach it — and `height: 100%` is the cell's *content* box
(31px of a 32px row, because the row's border is inside that 32), so the centre stays the centre
when the row height or its border changes. It is the same shape as `.db-name-cell`, for the same
reason: the entry icon beside a page name is not a line of text either.

Two things fell out of it, and they are the pattern worth keeping:

- **A measured claim about *presence* can be green while the geometry is wrong.** Every
  assertion about the checkbox before this turn was about whether the box was ticked. It was.
  `scripts/verify-db-checkbox.mjs` measures three states — `true`, `false`, and the untouched
  `null` a person has not clicked — because the complaint was about two of them differing, and a
  probe that renders one state can never see that.
- **The check has to run after the value changed.** The bug was a position that depended on the
  value, so the probe reads the geometry, presses the tick, and reads it again — same element,
  same scroll offset. Then it presses back and asserts it returned to the pixel it started on.

`tests/database-checkbox.test.ts` pins the two structural facts — the wrapper is the branch's
root, and it centres by flex rather than by a margin on the box — by file scan. Both were
falsified on purpose: removing the wrapper, and turning `align-items: center` into `flex-start`,
each fails them by name.

## One list, two surfaces, and why "import it" is not enough

The six date formats were written inside the property menu. The picker needed the same six, so
they moved to `date-format-rows.tsx` and both files import it — that is the reuse rule, and it is
only half of it. A file can import the rows and *also* draw its own beside them; the surfaces
then agree by coincidence until one of them grows a seventh format.

So the guard is on the count of mappers, not on the presence of an import:
`dateFormatChoices.map` may appear in exactly one file. The same reasoning already covers
`group-controls.tsx` and the grip glyphs. And a name for a format lives in exactly one place,
`dateFormatLabel` — because a row that says `Full date` while the cell renders `2026/10/30` is a
column labelled with something it is not, and `iso` (what the owner's own column stores) is
exactly the value a second, naive lookup would have answered `undefined` for.

## A press on a container is a press on everything inside it

The owner: *"A lot of the times when editing different cells i accidentally or even intentionally
double click, which throws me inside the page ... i should only be able to open up the page by
clicking the designated open button which we already have."*

The `<tr>` carried `onDoubleClick={() => onOpenRow(row.id)}`. Read as code it looks like "the row
opens the page", which reads as reasonable. Read as an event it is something else: `dblclick`
bubbles from whatever was pressed, and the `<tr>` is an **ancestor of every cell in the row**. So
that handler fired for a double press in a text field — where a double press means *select this
word* — for a double press on a value tick, and for a double press on the name you were about to
rename. It could not tell them apart, because it never knew which cell was pressed.

Three things were wrong at once, and each of them would have been enough:

- **The listener was on the wrong element.** A cell owns what a press in it does. A row is a
  container. There is no double press whose meaning is "the row" rather than "this cell".
- **`cursor: pointer` said it was a link.** `.db-row-open { cursor: pointer }` is the cue every
  interface uses for "a press goes somewhere". A row is not a link, and after the handler went the
  class existed only to promise a click that no single press performed.
- **There were two routes to one page.** The row already shipped a named `Open` button. A second,
  invisible route does not add convenience; it adds a way to lose an edit.

So: no handler on the row, no `db-row-open`, and no `onDoubleClick` in `entry-icon.tsx` — that
`stopPropagation()` existed *only* to keep the icon's own double press away from the row's handler,
and a guard for a handler that no longer exists is dead code that reads as a fix.

The remaining route is a button, and a button that cannot be seen must not be able to be pressed:
`.db-open` is `opacity: 0` **and** `pointer-events: none` until the row is hovered or something
inside it has focus. Both halves are asserted, because revealing it and letting it be pressed while
invisible are two different mistakes.

The guard is a count, not a comment: `tests/database-row-open.test.ts` fails if `onOpenRow` is
called more than once in `table-view.tsx`, if the `<tr>` carries any `on[A-Z]` handler at all, or if
the row element or its cells wear a pointer cursor. It was falsified against the pre-fix tree — all
five assertions fail there — and so was the probe, which is the next section.

## How do you know the probe would have failed?

A probe written after a fix passes. That is not evidence; it is the definition of a test written
against the code that exists. The question is what it would have said **before**, and the honest way
to answer it is to run it against the tree before.

`run-row-open-probe.ps1 -Before` copies the project, then rewrites the copy's `table-view.tsx` and
`database.css` back to the shape the bug had — the `<tr onDoubleClick>`, the `db-row-open` class,
the `cursor: pointer` rule — starts it, and runs the **same** probe file. It then fails the run if
the probe passes there. It does not:

```
--- tree rebuilt as it was BEFORE this turn: the probe must fail here ---
  PASS the text cell is pressable at this width
  FAIL a double press inside a text cell does not leave the table
       #45703666-e1be-4662-bb34-8b1eec9ca0b0 -> #fcce28bf-3201-413f-8851-03c3f1171443
  FAIL and the table is still drawn  0
  FAIL and the caret is still in the field it was typed in
  FAIL and the half-typed value is still there  null
FAILED: 3/18 passed @ 1400x900
```

Two traps sit on the way to that output, and both cost a run:

- **`Set-Content` / `Get-Content` in PowerShell 5.1 are ANSI.** Rewriting a source file with them
  turned its em dashes into bytes Turbopack refuses (`invalid utf-8 sequence`), so the run failed
  at compile time and looked like a probe failure. Use
  `[System.IO.File]::ReadAllText/WriteAllText` with an explicit UTF-8 encoding. The same rule goes
  for the script file itself: a `.ps1` is read as ANSI too, and a `”` byte inside a double-quoted
  string is a **string terminator** to PowerShell — which is a syntax error reported on a later
  line than the one that caused it. Keep `.ps1` files ASCII.
- **A probe that dies mid-run hides the rest of its claims.** The first version threw on `#4` of
  18, because the row it meant to read was gone — the page had changed. Every press is now
  conditional (`pressable(label, point)`), so a navigating tree produces a full list of failures
  instead of one stack trace.

## Two presses are not a double press

`b.mouse()` sends one press with `clickCount: 1`. Calling it twice does **not** produce a
`dblclick` — Blink dispatches that event from the **second press's `clickCount`**, so two presses
counted as two separate clicks select a word and fire nothing. A probe that calls `mouse()` twice
and asserts "the double-click handler did not fire" has proved nothing at all; it never reached the
handler.

```js
await b.doubleMouse(x, y);   // pressed(1) released(1) pressed(2) released(2)
```

`verify-db-row-open.mjs` also dispatches a `dblclick` straight at the row's markup, because a real
gesture can be swallowed by an overlay or a stale scroll offset and that check cannot.

## A link cell should be clickable, and a press in it must not be a click

The owner asked for both, in the same sentence: *"links should also be clickable if they are on the
URL property cell"* — one turn after *"i should only be able to open up the page by clicking the
designated open button"*. Those two sentences are the same rule seen from two sides.

A URL cell is a text field. A press in it puts a caret; that is what a press in a text field means,
and every other column here does exactly that. So making the *text* a link would mean the one
gesture people use most inside a cell — click, then type — throws away the edit and opens a
browser tab. That is the double-click bug from the previous turn, one gesture earlier and easier
to trigger by accident.

So the cell keeps the field, and the address opens from a designated mark: a `↗` at the cell's
right edge, drawn by the row's `Open` button's own rule (`opacity: 0` and `pointer-events: none`
until the row is hovered or something in it has focus). Two openers in this app now, one
vocabulary. And it is a real `<a href>`, not a button with a handler — the browser then owns the
parts that are not our business: the address in the status bar, ⌘-click, the middle button,
"open in a new tab" without losing a half-written table.

The read-only table is the exception that shows why the rule is about *competition*: with no field
to put a caret in, the text is the link (`UrlText`), on the same principle as the row's named
button — the press has one obvious meaning there, so it does not need a mark to disambiguate it.

## A measurement is only a measurement if its output names what it measured

The URL probe's first "does the short link fit its column" check measured the string
`"undefined"` and passed: it called a canvas in the field's computed font but collected the `<td>`
instead of the `<input>`, so `measureText(field.value)` measured the word `undefined` at 62px.
`62px` looks like a plausible result. What gave it away was the caption printing
`reading undefined`.

Two habits came out of it, and they are cheap:

- **Print the thing you measured, not only the number.** `117px of ink in 159px of field, reading
  "example.com/docs"` can be read by someone who was not there; `62px` cannot.
- **Use a check that fails when the value changes.** "The field is not scrolled" would have passed
  for every possible value: `scrollWidth` equals `clientWidth` on an `<input>`, whatever its
  contents. A check that cannot distinguish the states it exists to tell apart is a paragraph with
  a `b.check` around it.

`scripts/run-url-probe.ps1 -Before` is the other half of the same idea: it reverts the formatter
and the mark's rest state in the copy and asserts the probe **fails** there (22/30, eight named
checks, including `196px of ink in 159px of field`).

## The `background` shorthand is not a second coat of paint

The URL mark is a box drawn *over* the tail of a long address. Its fill was
`background: var(--surface)`, and its hover state was `background: var(--hover-strong)` — and
`--hover-strong` is `rgba(255,255,255,0.07)`. Both lines look like "tint the button". They are not:
the second one **replaces** the first, because `background` is a shorthand that resets
`background-color`, `background-image`, `background-position` and the rest. So the fill went from an
opaque surface to a 7% white wash, a wash is transparent, and the address underneath read through
the box at precisely the moment the pointer reached for it. The row's `Open` chip carried the same
line over the end of the name, and had the same bug, unremarked, since it shipped.

A tint over a fill is a layer:

```css
background-color: var(--surface);
background-image: linear-gradient(var(--hover), var(--hover));
```

Two consequences worth keeping:

- **Computed-style assertions cannot see this class of bug.** `getComputedStyle(mark).backgroundColor`
  would have returned exactly `rgba(255,255,255,0.07)` — the right answer to the wrong question, and a
  test comparing it to the token would have passed. "Is it opaque" is a question about the
  composited frame, so `browser-session.mjs` now has `b.pixel(x, y)`: a 1×1 `Page.captureScreenshot`
  decoded to an RGB triple. That screenshot's `clip` is in **page** coordinates while every caller
  holds a `getBoundingClientRect()`, and the two differ by the scroll — measured, not assumed (a red
  block at document y=1000 with the window scrolled to 800 is sampled at `pixel(x, 1030)` and *not*
  at `pixel(x, 230)`), so the conversion lives in the helper where it cannot be forgotten.
- **Test the control, not the text under it.** The probe puts a saturated patch behind each opener
  and compares the same three interior pixels with and without it. Text has antialiased edges and a
  fill test against a moving edge is a coin toss; "does *anything* show through" has one right
  answer. Post-fix the difference is `0/255`; on the pre-fix tree it is `217/255` and the screenshot
  shows the address through a pink box.

## One value, read once

The URL probe's "the cell reads the full address" check evaluated `cellText("Site")` twice: once for
the assertion and once for the caption. When the first call caught the cell one re-render behind the
tick, the run printed

```
FAIL the cell reads the full address immediately   cell "https://newsite.test/"
```

— a check that failed while its own caption showed the expected value. Both readings had happened;
they just described different frames. It reads one value until it settles and reports *that* value.
The rule: **a check has one subject**, and if the subject is a moving target, the probe waits for it
rather than asserting on a different frame than the one it prints.

## A wait names the state, not the element it is drawn with

The place probe's first version waited for `!!document.querySelector('[data-db-popover]
.db-place-note')` before reading a search result. The wait returned immediately — the idle panel
draws that same paragraph, saying *"Type a place or address"* — so three checks read a note from
before the request came back and reported it as the answer:

```
FAIL a search that finds nothing names the query it searched for
     note "Type a place or address"
```

Nothing was wrong with the app; the probe was early, and the element it waited for appears in more
than one state. The fix is not a longer sleep — it is `until(state => …, label)`, which takes the
*state* the check is about ("nothing found", "the failed surface", "rows exist") and prints the
whole last surface on a timeout. **A condition that several states satisfy is not a wait; it is a
coin toss with a timeout.**

## A place is two shapes, and only one of them has a point

`place.ts` shipped saying coordinates belonged in metadata rather than in the value. That was the
right call for a freeform column and the wrong one for a column with a map behind it.

A map needs one point per **row**. A row's data is its cells. So a point kept anywhere else — a
config, a side property, a cache keyed by row id — is a second copy of a fact the address cell
already owns, and the first time somebody types over the address the second copy is stale with
nothing to notice it. Therefore:

- **`"…"`** — typed. No point. Today's bytes, unchanged.
- **`{ address, lat, lng, name?, id? }`** — picked. The record *means* "this place has a location".

`coerce` collapses `{ address }` back to the string, so the two spellings cannot both exist for one
place, and `placeCoordinates` answers `null` for the string rather than 0,0. The cost is that a
typed address is a row a map cannot plot; that is a decision the map view has to make out loud,
which is the correct place for it.

## The one outbound request goes through the server

The Place cell could have called a geocoder from the browser and skipped `src/server/places.ts`
entirely. Three things stop that, in order of how much they cost:

1. **Privacy.** Every keystroke of a half-typed home address, plus the owner's IP, would go to a
   third party. This app is local-first and `SECURITY.md` says so.
2. **Policy.** OSM's Nominatim forbids auto-complete outright; the provider is Photon, which is
   built for it. That rule is only enforceable somewhere we control the request.
3. **Behaviour.** A cache on the server answers four rows asking the same question once, a
   `User-Agent` we choose identifies the app instead of a browser, and one environment variable
   (`RASPBERRY_PLACES_URL`, `off` to disable) turns the whole thing off.

The visible cost: search needs the Next server, so a static export would not have it. That trade is
already made everywhere else in this app.

## A search box must not be able to lose what you typed

The Place column was freeform text for months. Making it a search box therefore adds a way to lose
data: an address the provider does not know, typed while the provider is unreachable, has no row to
click. So **every state that is not a list of results still offers `Use "…"`** — no matches, search
off, service unreachable — and `Enter` there stores exactly the text that was typed, as a string.
The alternative, an empty dropdown, turns a network problem into a data-entry problem and asks the
person to solve it by retyping.

## A geocoder's index is global, so the ranking has to be ours

The owner searched `Rašica 53` and got `53 Rašice` in Slovakia; he searched `Grahovo Brdo 1` and got
a row headed `Turistična kmetija Mahnič`. His reading was right and better than a bug report: *"they
are just showing that there is a global problem that needs fixing."*

Global is the word. Photon holds a street called something like *Rašica* in every country that has a
similar name, and which one it puts first is a fact about its index, not about the person typing.
Nothing in the query said "Slovenia" — except the query itself, and that is the only thing we have.

**Before changing anything, what the map data contains was measured**, and the two complaints turned
out to be two different problems with one thing in common:

- House 53 on `Rašica` in Velike Lašče **does not exist in OpenStreetMap**. Overpass says the street
  has two mapped addresses in the whole country: 40 and 12a. Notion returns it because Notion is not
  an OSM geocoder. So chasing that row means chasing a data source we do not have; the honest answer
  is the village, said plainly.
- `Grahovo Brdo 1` **is** in OSM, as one node tagged `name=Turistična kmetija Mahnič`. The answer was
  right; the *label* was wrong, because the column always printed the place's own name.

Three rules came out of that, and they are rules rather than fixes because the next query will be a
village in some other country:

1. **A trailing house number is a second question, not part of the name.** Photon satisfies the
   number and lets the name go fuzzy — the real top ten for `Rašica 53` were ten streets ending in 53
   in five countries. Asked as `Rašica`, the same index answers perfectly. So an address is asked
   twice and the answers are merged; the ranker decides between them.
2. **A near-miss name is a different word, and a house number cannot tell two countries apart.** The
   similarity score is capped hard when a number is present: `Rašice` is not `Rašica` at 0.45.
   Without a number the same string scores far higher, because a typo *should* be findable — the
   cap is about what the number is being asked to do.
3. **A row's bold line is whichever field answered the query.** The farm does not disappear; it moves
   to the dim line and stays in the stored `name`. And the word order repeats the query's, because
   "Rašica 53" and "12 Rue de Rivoli" are the same two facts in two conventions and a Photon answer
   contains no formatted address to borrow.

The relevance floor — dropping near misses when the name matched confidently — is **off for name
queries**, and that distinction was not reasoned out: breaking the existing "Eiffel" assertion is
what surfaced it. `Champ de Mars` does not match the name `Eiffel` at all, and hiding it would be
the app deciding the park at the tower's foot is irrelevant. A result that does not resemble the
query is a *neighbour*; a result that half-resembles it is a *false match*. Only the second is the
address bug.

## A free service has a rate limit, and the app is the one that has to behave

Measured, not feared: about **twenty requests inside two minutes** and the public Photon instance
stopped answering this machine entirely — 503s, then TCP connect timeouts, for the rest of the
session, while Nominatim and example.com answered in under a second. A person typing a fifteen
character address at the old 260ms pause fires about fifteen requests in four seconds.

So the pause is 380ms, an address query is at most two requests, a 5xx is retried **once** (a refused
connection is not briefly busy and retrying it only doubles the wait to learn the same thing), three
consecutive failures open a **circuit breaker** for thirty seconds, and a cache entry up to an hour
old is served instead of an error. `/api/places/search` answers `503 places_busy` separately from
`502 places_unavailable`, because "wait" and "something is broken" are different instructions and the
client says so.

The lesson generalises beyond this feature: any dependency on somebody else's free service needs a
budget the *app* enforces, because the person typing has no idea they are spending it.

## The cache outlives the code that wrote it

`src/server/places.ts` parks its cache on `globalThis` so a dev-mode hot reload does not cold-start
it — the same reason `runtime.ts` parks its service there. The cost showed up the moment the entry's
shape changed: the previous version stored `{ at, hits }`, the ranking move made it
`{ at, features }`, and an entry from before the reload was a truthy object with no `features`. Every
search then answered "nothing found" — no error, no log, a perfectly well-formed empty list — until
the process restarted.

The tests all passed, because a test starts with an empty cache. It was found by **calling the live
route** after the change and reading the body. An entry is now only an answer if it still has the
shape of one. Anything parked on `globalThis` is data from a previous version of the program, and
must be validated on read rather than trusted because it type-checks.

## A missing record is not a ranking problem, and no amount of ordering fixes it

The owner's second report on the Place cell: *"Query doesn't give Rašica 53, only Rašica … they are
just showing that there is a global problem that needs fixing."* The first instinct — that the
ranker was ordering the rows wrongly — is wrong here, and it was worth ten minutes with Overpass to
know that rather than an hour rearranging scores. `addr:street=Rašica` inside Slovenia returns **two**
addresses, 40 and 12a. House 53 is not in OpenStreetMap at all, so Photon cannot answer with it and
neither can Nominatim, and Notion's `Rašica 53, 1315 Velike Lašče` comes from data we do not have.

The trap is treating "the provider had nothing" as an empty state. That throws away the half of the
query the person is most sure about — the number they wrote — and a list of bare streets under a
typed number reads as the app ignoring it. So the row is **composed**: the address as typed, with
the point of the road it would be on. The typed house number is never dropped, and it is never
silently placed with a precision that was not measured — the value carries `approx`.

The same reasoning applies to any "not found": the question to ask first is *is it absent from the
source, or absent from my ordering?* They have different fixes and only one of them is code.

## A house number is an address on a road, so the road is what gets counted

Where to put a composed address is the whole difficulty, and the rule has to come from what a house
number *is* rather than from the examples.

`Rašica` is two villages in Slovenia. Their names are identical and nothing in the query says which.
What the provider's answer does say is how many **roads** called `Rašica` each has: four in Velike
Lašče, two in Ljubljana. And the only two houses OSM really has on that road — 40 and 12a — are both
`1315 Velike Lašče`. So the count is not a heuristic about popularity; it is a proxy for "where the
road with that name actually is", available without a second request, and it lands on the postcode
Notion shows.

Which means two limits, both deliberate:

* **roads only, when the answer holds any road.** A settlement can carry a house number, so a village
  with nothing mapped in it is still an address space — but a landmark, a stream and a shop cannot,
  and "Eiffel Tower 1" would be the app inventing a place instead of finding one.
* **the settlement is the group key, not the postcode.** One long road is split across three
  postcodes; three rows reading `Rašica 53` with different postcodes is a worse question than one
  row plus the other village beside it. The other village stays on the list, because being
  confidently wrong half the time is worse than offering both.

Proven by mutation rather than by argument: drop the count from the group order and the first row
becomes Ljubljana; count every addressable row instead of roads and three Ljubljana districts outvote
one Velike Lašče road. Both were run against the tests, and both failed by name.

## An approximation belongs in the value, not in a comment

The point on a composed row is the road's centroid. A map that drew it exactly like a door would be
claiming a precision the map data does not have — and the map view is coming, which is why this is
decided now.

`approx: true` is stored in the cell (a string is what a *typed* address is, so the shapes stay: no
point, a point, a point that is really the road's). `placeReading` exposes it as `approximate` so
the drawing code never has to infer it from how many decimals a coordinate carries — the number of
decimals a provider sends is a formatting habit, not a measurement. And `coerce` **keeps** the flag
and never recomputes it: the server sits between the cell and the file, and a coercion that dropped
it would turn a road back into a doorstep silently.

The cell still reads only the address. Marking the approximation inside the field would be the app
editing what somebody wrote; the honesty belongs where a decision is being made — the list row and
the map marker — not in the text. The list says `No house 53 in the map data — it is placed on the
road, not the door`, which is a fact about the map twice over.




## A second outbound request needs its own switch, not a clause in the first

`RASPBERRY_PLACES_URL` documented itself as "the only variable that could change" the fact that
Raspberry talks to nobody. Then a map preview needed four more requests per cell. The tempting
move is to make tiles follow the place switch — one variable, one story — and it is wrong: search
and tiles are different providers with different policies, an owner may want the map without the
autocomplete (a self-hosted tile server, OSM blocked), and a settings variable that silently
controls two hosts is a variable nobody can reason about from its name.

So: `RASPBERRY_TILES_URL`, its own `off`, and `.env.example` rewritten to say **two** rather than
"the one". The sentence in a doc that says "only" is the one that goes stale, and it goes stale in
the direction of overclaiming privacy — the worst direction for a local-first app.

## The browser may not name a tile server, even though it could

`<img src="https://tile.openstreetmap.org/16/33185/22545.png">` works, is one line, and is what
most OSM-backed demos do. It is also a request that carries this machine's address, the fact that
somebody just picked a place, and a Chrome user-agent to a stranger, four times per cell — and
OSM's tile usage policy requires a tool to identify itself, which a browser `<img>` cannot do.

Through our own route the browser names a *square of the world*, and the server decides which host
renders it and says who is asking. The cost is a route, a cache and a test that has to prove the
negative ("every request the page made stayed on this machine") — which no rectangle-based
assertion can do, because both implementations draw the same pixels. `scripts/verify-db-place-map.mjs`
answers it with CDP's network log instead, and that check is the reason the proxy exists.

## A map is four pictures and a projection; a map *library* is not needed

At 226×150 a map is four 256px images and a pin. A library brings a canvas or a WebGL context, a
second theme system, its own gesture handling and its own tile fetching — and hides forty lines of
arithmetic that the database's map view will need anyway, at a different size and zoom.

So `src/lib/geo/mercator.ts` is the projection and the tile grid, `src/lib/geo/preview.ts` is this
box's policy, and the component is a `<div>` with images in it. Two decisions inside the grid
matter: the origin is rounded **once** so every square lands on an integer offset (a compositor
rounds fractional neighbours independently, and two independent roundings of adjacent edges is a
1px seam), and the box's centre *is* the coordinate, so the pin is never placed by a second
calculation that could disagree with the first. `tests/geo-mercator.test.ts` checks both, and the
"integer offset" assertion was the one that caught its own comment being wrong.

## A raster basemap cannot be themed, only filtered — and the obvious filter is the wrong one

OpenStreetMap's standard tiles are drawn for a light page. Inverted (`invert(1) hue-rotate(180deg)`)
they become a dark map with **black streets on a near-black ground**, because OSM paints roads
lighter than land and inversion flips that relationship. It looks like a dark map in a thumbnail and
like noise at 226px.

The fix is not a colour: it is to give back some of the relationship the inversion destroyed —
`invert(.9)` leaves 10% of the original, `brightness(1.18)` lifts the ground off black, `contrast(.82)`
and `saturate(.55)` stop the parkland and the footpath dashes from glowing. Four variants were
rendered at 3× and looked at, which is the only way to choose between them; a computed-style
assertion would have said all five were "a filter". The light theme turns it off entirely, because
there the basemap is already the right way round.

## The one control in the card that looked wrong in a screenshot and nowhere else

The `×` wore a boxed 28px border. Every assertion about it passed: it was a button, it had a label,
it sat where it should. The class list said `db-prop-icon-btn db-place-card-clear` — the base, and
a size modifier, without `db-menu-back`, which is the modifier that drops the chrome. Written from
the comment ("borrowed from the pane head") instead of from the class list, and caught by looking at
the render at 3×.

That is the general shape of this class of bug: the components are consistent, the *string* is not,
and nothing but a picture compares the two.

## The way out of a place is Google Maps, and it is asked in coordinates

The owner: *"for the external link to open it in 'openstreetmap' we could probably do it so it opens
in google maps since its probably just a link with the address right?"* Half of that is exactly
right — it *is* just a link, one `href`, nothing to install — and half of it is the trap.

**Why Google rather than OpenStreetMap.** The card's arrow went to
`openstreetmap.org/?mlat=…&mlon=…#map=…`: a URL that only parses for somebody who already knows what
OpenStreetMap is, carrying a fragment syntax we would have to explain. The arrow means "show me this
somewhere I can navigate", and that is Google Maps for everybody who is not us. Nothing about the
*map preview* changes — its squares are still OSM's, still through our own route, still credited.

**Why the query is the coordinate and not the address.** `?query=Rašica 53, Velike Lašče` is the
version that looks more helpful, and it hands Google a sentence to **re-geocode against its own
database**. That is a second opinion about where the place is, produced by a different geocoder, and
it is allowed to disagree with the pin this card drew a pixel earlier — which is the same class of
bug as B51's `Rašica 53`, where the answer depended on whose index was asked. For a *composed*
address the disagreement is guaranteed: we drew the road, Google has the door. A coordinate cannot
be re-geocoded, so the tab that opens shows the point that was drawn. The tooltip says what the link
does, and there is nothing to configure — a link is not a fetch, and this is the one outside
destination the app has that costs nothing at rest.

Two smaller things came out of it. `osmLink(point, zoom)` took a zoom only for OSM's `#map=`
fragment, so it became `mapLink(point)` — a parameter that exists for one provider's syntax is a
parameter that outlives the provider. And the probe asserts the `href` **whole** rather than
matching a prefix: a check `/^https:\/\/www\.google\.com\/maps/` would pass on
`?query=Eiffel%20Tower`, which is exactly the mistake the test exists to catch, so the absence of
`%20`, `+` and the place's own name is part of the assertion. Falsified by putting the OSM URL back:
**exactly one named check fails, at both widths.**

## A file cell holds a list of references, so the field cannot be a text box

`files.ts` has known the value shape since B26: a list of `{id,name,mime,size}` pointing into the
content-addressed uploads store, so that the same photo in three cells is one file on disk. What the
*editor* did not know is that the type exists. `cell-editor.tsx` maps a type to a control and falls
back to the shared text field for anything it has not met, and `files` was never met — so the column
looked like a text column, and typing `holiday.png` into it stored `[{id:"holiday.png",…}]`: a
reference to bytes that were never uploaded, in a cell that then renders a 404. That is the first
reason the cell is a **button** and not a field. The second is that there is nothing to type: the
name of a file is its name, not something you can improve by editing it.

Which leaves the question the owner actually asked — "a good solid and simple ux" for one-or-more
files — and the answer this app already had for every other cell with a surface behind it: press it,
a 252px `MenuSurface` opens under it, press it again or `Escape` or a press outside closes it. Three
decisions were not inherited:

**The cell shows one file and a count.** A cell is 120–220px wide and a row is 32px tall; five
attachments cannot be read there, and a heap of thumbnails says "there are some" without saying
*which*. So the first file gets a 22px tile — the picture if it is an image, an extension badge
(`PDF`) if it is not — then its name, then `+2`. The panel is where the list lives.

**A batch is one write, and it is committed from a ref, not from `value`.** Uploading three files
commits three times? No: each file goes up through the app's one uploader, each spinner replaces the
last, and the cell is written **once** after the last one lands, with everything that did. The
temptation is to append to `fileList(value)` on each success; the bug there is that `setPending`
re-renders between files, so `value` read mid-batch is the *pre-batch* list, and file two's commit
silently drops file one. The list being accumulated is a ref, refreshed from props only when no batch
is running — because mid-batch, the only thing that can change the signature is our own earlier write,
which the ref already holds.

**A refused upload does not sink the batch, and removing a reference never deletes bytes.** An empty
file is refused by the store with its own sentence ("empty.txt is empty"); that is a red line in the
surface naming the file, and the files that did land are still committed — a batch that fails in the
middle is not a batch that did nothing. And a `×` removes the *reference*: the store is
content-addressed, the same photo may be attached to three rows, and a delete that swept the blob
would empty the other two cells. Nothing in this app deletes an upload; if the bytes ever need
collecting it is a vacuum pass over unreferenced hashes, not a button in a cell.

Two smaller things this pass had to fix rather than add. `Retry` and `Upload` are the same control — a
short verb in a box — so `.db-retry` became `.db-mini-btn` with two callers, because a class named
after its first caller is a lie the second time. And the cell-as-button box that the tag cell and the
date cell each declared for themselves is now **one selector list** with `files` in it: a third copy
is precisely the "redraw it instead of reusing it" complaint, one level below the grip glyphs.

## Dropping a file is the second way in, never the only one

Drag-and-drop is invisible. It is a gesture you have to already believe works before you try it, and
an empty Files cell that accepted only drops would read, to somebody who does not drag, as a column
that does not work. So `Upload` opens the OS picker and is always on screen; dropping files on the
cell or on the open panel is the *second* way in; and the empty panel says both, in five words:
*Drop files here, or press Upload.*

The handlers are ordinary, with two details that are not. The drop target must `preventDefault()` on
`dragover` or the browser refuses the drop *and* navigates the tab to the file — losing a
half-written table, the exact accident the URL cell's `↗` was drawn to avoid. And the drag check is
against `dataTransfer.types` including `Files`, because the row grip's reorder is also a drag: a cell
that swallowed every drag would break reordering by being a drop target.

The probe cannot synthesise an OS drag — the input domain has no such event. What it can make is a
real `DataTransfer` holding a real `File`, dispatched as `dragover` and `drop` on the cell, which
exercises every line of *our* handling and none of the browser's. That line is drawn in the probe's
header rather than left implied, because "the drop works" is a claim about two halves and only one of
them is testable here.

## Saving a file is a request to the server, not an attribute on a link

`<a href="/api/files/…" download="holiday.png">` is one word and looks like the whole feature. It is
a **hint**: the browser may ignore it, and it cannot name the file as reliably as the store already
does. Every type the store shows in place — images, audio, video, PDF — is served `inline`, which is
right for the name link and wrong for a save: the person asked to keep the file and got a tab.

So `?download=1` asks the store for the same bytes with `Content-Disposition: attachment`, naming the
file from its stored name. Two consequences worth stating:

- **It can only make a response more restricted.** A `.html` upload is already an attachment; the
  flag changes nothing there, and nothing in this route can turn an attachment into a document on
  our origin.
- **`fileDownloadHref` is the only place the query is spelled.** The same rule `fileHref` already
  followed — a URL that exists in two files drifts, and the probe can then only measure one of them.

## A preview is not a menu, so `menu-place.ts` is the wrong arithmetic

Both are fixed boxes placed from a rect, and copying the menu's placement into the peek was the
obvious move. It would have been wrong twice over.

**Direction.** A menu is anchored to the trigger it acts on and must stay attached to it. A peek is
*beneath* nothing and acts on nothing — it belongs *beside* the row it describes, and a peek that
slid sideways over the row would cover the name it was drawn to illustrate. So: right of the row
always, left only when the right would leave the screen, and never flipped vertically — a preview
above or below its row is a preview whose subject you have to guess.

**Motion.** `menu-place.ts` has `atPointer` for context menus, because there the click *is* the
target. A peek appears 300ms after a rest, which means it must not trail the cursor: a box that
moved every time the mouse moved within the row would read as a rendering fault. It is placed from
the row's rect, once, and re-read on scroll and resize so a peek beside a row that scrolls stays
beside it.

`src/lib/peek-place.ts` is that arithmetic with no React in it, for the same reason the projection
is a library: the corners of the screen — a row under the bottom edge, a viewport too narrow for
either side — are where the rules bite, and they are cheap to test and expensive to reach with a
browser.

## One rule decides "is this a picture", and it already existed

The ask was "only if an image file or svg", which sounds like two cases and is one: `image/svg+xml`
starts with `image/`. The peek therefore calls `isImageFile` — the same function the 22px tile uses
— and `tests/database-files.test.ts` fails if a mime prefix ever appears in `file-peek.tsx`. A second
list of types in the preview is how the tile and the peek start disagreeing about the same file six
months from now, and the bug would look like "the preview is broken for SVGs" rather than "there are
two answers to one question".

The corollary is a deliberate silence: a PDF gets **no box at all**. Not a placeholder, not a
document glyph, not a spinner. A preview that appears for a file it cannot show teaches the person
that hovering is unreliable.

## A box that follows the pointer must not be able to take it

`pointer-events: none` on the peek is load-bearing rather than a nicety. The box appears beside the
row the pointer is already in. If it could be hit, the pointer would leave the row the moment it
appeared over the cursor's path, which closes the peek, which removes the box, which puts the row
back under the pointer — a blink loop that only shows up when the panel is near the right edge,
which is exactly where the peek has to flip.

`aria-hidden` follows from the same fact: the row already says the name, the size and whether the
file is a picture, so the peek is a second rendering of a line a screen reader has just read. It is
still shown on **focus** as well as hover, because the two buttons and the link in that row are
already tab stops and a keyboard user has the same question ("which picture is this?") with no
pointer to ask it with — but nothing about it is announced, so focus buys the picture and not a
paragraph.

## A formula is a language with a parser, never an expression handed to `eval`

`config.expression` is user input of the most arbitrary kind, on the same process that holds the API
and the workspace key. `new Function(expression)` is one line and would be a remote code execution
hole the day a formula arrives from a shared page, an import or an MCP call. So the module owns the
grammar: `tokenize` → `parse` (a Pratt parser, precedence as a table) → `evaluate`. Nothing in
`src/lib/database/formula/` can call the runtime's evaluator, and the worst a formula can do is
recurse over its own arguments.

The secondary payoff is the editor: because the tokens carry their source offsets, the syntax
colouring and the parser cannot disagree about where a string starts. When the highlighter was a
separate regex it disagreed the first afternoon — an unclosed quote coloured the rest of the line.

## An empty cell is nothing, not the wrong type

`prop("Price") * 2` on a row with no price must read **blank**. The first implementation let
`numberArg` reject `null` with "expected a number, but got nothing", which painted a red sentence in
every row that had not been filled in yet — a formula column that looks broken while it is working
correctly. The rule is now one rule, applied by the operators *and* by `add`/`subtract`/`multiply`/
`divide`/`mod`/`pow`:

| the argument | the result |
| --- | --- |
| empty (`null`) | empty — the row says nothing, so the formula says nothing |
| text in a number slot | **an error**, naming the argument and what it actually is |
| a date in a number slot | an error, same sentence |

A wrong *type* is a mistake somebody can fix; an absent value is a fact about the row. Mixing them is
what makes people stop reading a column. Comparisons follow the same shape: `<`/`>` with an empty
operand is `false`, because "is this empty date later than today?" is a no, not a broken cell.

## The computed value is written into the payload, not into sqlite

A formula has no `database_cells` row — `derived: true` is the promise, and the write path refuses a
value for the column. The alternative was a second read path: a view would ask "is this property
computed?" and call the evaluator itself, and every caller that forgot would render an empty column.
So `applyFormulas` runs **once, on the server, after the rows are read**, and puts each value in
`row.cells[formulaId]`.

Everything downstream then works with no special case, including things that will be written later:
`sortedRows`, the filters, the groups, `formatCell`, the MCP export and the API's own JSON. The cost
is that the value is recomputed on every read — which is the correct behaviour for `now()` anyway.

`tests/database-formula.test.ts` pins the shape: a row set with no formula columns comes back as the
**same array** (`applyFormulas` returns `rows` untouched), so a table pays nothing for the feature.

## The examples in the help are the examples the tests run

Every function's documentation carries `examples` with the printed result. The editor *executes*
each one against the page in the preview strip and shows what came back; `tests/database-formula`
executes them again and compares to the stored result, and `fails: true` marks the ones that are
supposed to fail (the divide-by-zero case must keep failing).

That is the only arrangement where documentation cannot rot silently. A help page is prose, and
prose about code is wrong the third time somebody edits the code. Here the help and the answer are
the same call, and a summary that stops being true fails the build.

## The painted layer and the field share their metrics, or the caret lies

The formula field is a `<textarea>` with `color: transparent` over a `<pre>` that holds the coloured
tokens. Both declare the same font, size, line-height, padding, `white-space: pre-wrap` and
`word-break`, and the `<pre>` mirrors the textarea's `scrollTop` on every scroll.

Any one of those drifting by a pixel moves the visible word away from the invisible caret, and the
symptom is not "the colours are misaligned" — it is "the editor puts my cursor in the wrong place".
The probe's strongest assertion is therefore the dull one: `pre.textContent` must be **exactly**
equal to `textarea.value` (minus the zero-width spacer that keeps the last line's height).

The tokenizer is lenient for painting and strict for parsing, for a related reason: the interesting
moment for colour is halfway through typing `"hello`, and a highlighter that gave up at the first
unclosed quote would flash white exactly when somebody is looking at it.

## Opening a formula must not narrow the list, but the first keystroke must

The list of properties and functions is filtered by the word before the caret. That is right while
typing and wrong the instant the panel opens: the caret is at the end of an existing expression, so
the "word" is whatever that expression happens to end with (`2`, in `prop("Price") * 2`), and the
browser opens showing the four functions whose summaries contain a 2.

So narrowing starts on the first **input**, not on the first render. Notion behaves this way and the
probe caught the difference: `dateB` must narrow to one name, and opening `prop("Price") * 2` must
show `Properties` first.



## Uploads have two doors, because the platform closes one of them

A hosted function refuses a request body over **4.5 MB** at the platform edge. Not a limit the
app can raise: the request is discarded before a handler exists to read it. This app's own caps
are 25 MB for an image, 100 MB for audio, 512 MB for video, so most of what it claims to accept
could never arrive through `POST /api/files` on Vercel.

So above 3.5 MB the browser PUTs the file straight into the bucket with a presigned URL and then
reports to `/api/files/complete`. The threshold sits below the ceiling on purpose — headers count
towards it too — and lives in `src/lib/upload-limits.ts` because both halves have to agree.

Three things were measured against the live endpoint before the design was fixed, and each one
rules out an approach that looks reasonable on paper:

- A **signed** PUT is checked against `x-amz-content-sha256`; a mismatched body is refused with
  `XAmzContentSHA256Mismatch`. So the server-side path signs the real hash and the bucket itself
  enforces content addressing.
- A **presigned** PUT is refused unless the payload hash is `UNSIGNED-PAYLOAD`. That means a
  browser cannot be bound to a hash it declares, and any design that trusts a client-computed
  sha256 for deduplication is trusting the one party with a reason to lie. The direct path
  therefore lands at a random key under `i/<workspace>/<uuid>`, and `complete` reads the object
  back and hashes it. Slower, and the only version where "content-addressed" is a fact.
- `CopyObject` works, so a verified upload moves to `w/<workspace>/<sha256>` without a second
  trip through the function, and no schema change was needed to remember an interim key.

The signature is written against the spec rather than pulled in as `@aws-sdk/client-s3`: it is a
fixed computation over a method, a path and three headers, so the risk is not "we implemented
crypto", it is "we got the canonical request wrong", and that is a test rather than a hope. SMTP
is the opposite case and is a pinned dependency (`nodemailer`) for exactly that reason.

## A hosted deployment with no bucket refuses uploads

`/tmp` on a serverless runtime is per-instance and wiped on cold start, so "write it to disk and
carry on" produces a file that is a broken image by the next request — a failure that looks like
a bug in the browser three pages later. `FileStore` throws `storage_not_configured` instead, the
same way the deployment refuses to serve data when sign-in is unconfigured. A deployment that
says what it cannot do is worth more than one that half works.

---

## Sign-in is an address and a code, and the code opens an account that exists

The owner's requirement, in his words: *"User enters email address. If email address is
whitelisted and user exists send a one time code on users email address that expires in 5
minutes (6 digit code). User enters 6 digit code and is in."*

What was there before was Google OIDC, then the code as a second factor, with
`readAuthConfig` refusing the entire mode if `GOOGLE_CLIENT_ID` was absent. That made a
deployment which could sign two people in perfectly well report itself as misconfigured,
and it made an OAuth client a prerequisite for a feature nobody wanted from Google. The
provider is now optional and the code is the door; `beginLogin` refuses only itself
(`google_not_configured`) when asked for without a client.

Three things in that sentence are load-bearing:

- **"whitelisted *and* user exists."** Two gates, not one. The allowlist is a string in a
  deployment's environment; the account row is the database saying somebody has somewhere
  to put their notes. Requiring both means a typo in an env var cannot mint a workspace,
  and it means an address that is permitted but unprovisioned gets a clear refusal
  (`no_account`) instead of an empty app that looks broken. `pnpm accounts` is how a row
  exists — a deliberate second act, with `--adopt` naming the one address allowed to
  inherit the notes that are already there.
- **"expires in 5 minutes."** The Google flow allowed ten, because the row has to outlive
  a redirect to Google and back before there is anything to type. An email challenge has no
  such leg, so its expiry *is* the code's expiry — five minutes, `CODE_TTL_MS`, one number
  rather than a sentence in the UI that drifts from a column.
- **A code is not sent to an address that will be refused.** The checks run before
  `randomCode()`, not after. A code that is emailed and then rejected is a live credential
  sitting in a mailbox for no reason, and it teaches the person that the email was the part
  that failed.

`login_challenges.provider` (migration 8) is what tells the two flows apart at the second
step, because the one place they differ is the one that matters: `email` may only open an
existing account, `google` still provisions. Using `google_sub IS NULL` to mean "email
only" would have let a column name decide a security rule, and it is null on a fresh Google
challenge too, so it would have decided it wrongly for the window between "challenge
created" and "Google returned".

The state half of the `__Host-` cookie is now checked in `consumeCode`, as a digest, before
the attempt counter moves. It used to be checked once, in the OAuth callback, so an
`email` challenge had no use for it — and a leaked challenge id would have bought a guess
at 10^6. It is cheap to check and it means an id alone cannot burn the real person's
attempt budget.

## A mail sender is the one thing that cannot be faked

`RASPBERRY_MAIL_BACKEND=console` prints the code to the service log. On a laptop that is a
convenience; on a host whose logs somebody else can read it is a handover of every account.
So `console` counts as **not configured** in production, and `authConfigured()` is false
until a real sender is set — which makes `/api/health` say so, instead of the deployment
looking healthy and failing after somebody has typed their address and waited.

The relay shape (`http`) is `{from,to,subject,text}` to a URL with a bearer token, which is
deliberately Resend's own `/emails` body: a provider that speaks that shape needs an env
var, not a code change. The constraint that decides the choice of provider is not obvious
and is not about this codebase: a shared sandbox sender such as Resend's
`onboarding@resend.dev` only delivers to the account owner's own address, so the **second**
recipient needs a domain verified with that provider.

### Sending from a domain you already own dissolves that constraint

`support@preston-labs.com` already has an MX, an SPF record naming the host that will send,
and a DKIM key at `default._domainkey`. So the second-recipient problem disappears without
buying anything, and `RASPBERRY_MAIL_BACKEND=smtp` is enough.

### Verify against the certificate's name, never switch verification off

The first attempt failed before a password was ever offered:

```
Hostname/IP does not match certificate's altnames: Host: mail.preston-labs.com.
is not in the cert's altnames: DNS:eh2.neoserv.si
```

Shared hosting: the mailbox is served at `mail.<domain>`, the certificate is issued for the
provider's machine name. There are three answers and only one is acceptable.

- `rejectUnauthorized: false` — encrypts to whoever answers the socket. A password sent
  this way is not protected by TLS at all, which defeats the point of port 465.
- Point `RASPBERRY_SMTP_HOST` at the provider's machine name — works, and removes the
  name an operator can look up in DNS from the configuration, so the next person to debug
  this reads a hostname they cannot resolve back to anything on the domain.
- `RASPBERRY_SMTP_SERVERNAME` — connect to `mail.preston-labs.com`, present and verify
  `eh2.neoserv.si` in the SNI. Verification stays on; the friendly name stays in config.

`smtpTransportOptions` exists so that decision is a value a test asserts
(`tests/auth-smtp-transport.test.ts`), rather than something only a failed sign-in reveals.
The override is *absent* from the options when unset rather than `undefined`, because
nodemailer merges `tls` over its own defaults and those are different values.
