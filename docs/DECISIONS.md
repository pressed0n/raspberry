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

## Database: the decisions the plan left open, and how the code settled them

`docs/ARCHIVE/DATABASE_PLAN.md` § 7 listed what needed deciding. Where code has since
answered, the answer is recorded here so it is not re-opened by accident:

| Question | Settled as | Where |
|---|---|---|
| Does a view store a filter/sort *spec* or a compiled query? | A spec, interpreted purely each render. | `src/lib/database/types.ts`, `rows.ts` |
| Are rows pages, or their own table? | **Rows are pages.** No row table exists. | `src/server/databases.ts` |
| How is a cell write made idempotent? | Receipt envelope: every mutation carries an id, replaying it returns the stored result. | `src/server/databases.ts` |
| Where do formulas evaluate? | Server-side, pure, **never `eval`** — a parsed AST walked by the evaluator. | B44, not yet built |
| What does an empty value sort as? | Last, in **both** directions — this is documented on every `compare` and currently violated by descending sort. See the open risks in `STATE.md`. | `src/lib/database/properties.ts` |
| Does retyping a property with data coerce or refuse? | Code **refuses** whenever any cell holds a value (`409 property_in_use`); the plan wanted coercion-with-refusal-on-failure. No UI calls it yet — a decision still owed. | `src/server/databases.ts` |

The two rows above that cite `STATE.md` are the live defects. They are recorded in both
places deliberately: the decision is history, the defect is state.
