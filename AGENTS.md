<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Never delete the owner's pages

**Hard rule.** Do not trash, purge, soft-delete, or "clean up" pages in
`data/raspberry.sqlite` — not as tidy-up after a test run, not because they look like
fixtures, not because they are empty or "Untitled".

This was broken once: dozens of CDP test runs created fixture pages in the live
database, and the tidy-up soft-deleted pages the owner had not created. Their words:
*"you trashed a bunch of my pages. Not cool."*

How to test without touching their data:

1. **Prefer read-only verification.** Drive the UI and assert on geometry, DOM and
   rendered pixels. Writes can be verified by intercepting the request in CDP
   (`Fetch.enable` + `Fetch.failRequest`) and asserting the **body the UI built** — the
   server side is covered by unit tests against `tests/schema.ts`, not the live file.
2. **If a test must write**, record every id it creates in the same run and delete only
   those exact ids, and only ones that provably did not exist beforehand.
3. **Never** delete by pattern, date, title, emptiness, or "everything with no content".
4. When unsure whether something is yours: leave it and ask.

If an agent run does create litter, say so explicitly and offer to remove it — do not
quietly delete it.

## Reuse before you write

**Hard rule.** Before drawing any control that a document editor would plausibly already
have — a grip, a plus, a checkbox, a menu, an icon, a page glyph, a colour swatch, a
dialog — search for the existing one and import it. If it lives somewhere awkward, move it
to a shared file and import it from both places. Do **not** reach for `lucide-react`
because it is one import away.

This was broken once. The database's row gutter needed a six-dot grip and a plus; the
editor already had both — path-for-path copies of BlockNote's own — but they were private
to `components/editor/object-menu.tsx`. So the gutter was written with lucide's
`GripVertical` and `Plus`. Same names, same purpose, visibly different shape: lucide's dots
are hairlines, the established ones are filled. The owner's words:

> *"You did not re-use the 6 dot grip and plus components that are already established …
> Why are you constantly redoing them instead of using what is already established. You
> should make a skill for yourself or something that tells you to re-use existing
> components if they exist somewhere already."*

That rule is this section. A near-miss is worse than a clear difference: two grips that are
*almost* the same read as two unrelated controls.

### Where the shared vocabulary lives

| you need | it is | at |
| --- | --- | --- |
| **the grip-and-plus pair, as one control** | **`FrameAnchor`** | **`src/components/frame-anchor.tsx`** |
| the six-dot grip, the plus, as bare glyphs | `GripGlyph`, `AddGlyph` | `src/components/grip-glyphs.tsx` |
| a page's icon | `PageGlyph` | `src/components/page-glyph.tsx` |
| an entry's icon in a table row | `EntryIcon` | `src/components/database/entry-icon.tsx` |
| a property's type icon | `PROPERTY_ICONS`, `NO_ICON`, `DEFAULT_PROPERTY_ICON` | `src/components/database/property-icons.tsx` |
| a dropdown: surface, item, divider, submenu, dismissal | `MenuSurface`, `MenuItem`, `MenuSub`, `MenuDivider`, `MenuHeading`, `useMenuDismiss` | `src/components/database/menu.tsx` |
| the block side menu (verbs, colours, selection) | `ObjectMenu`, `FrameMenu` | `src/components/editor/object-menu.tsx` |
| a modal | `Modal` (default export) | `src/components/modal.tsx` |
| a colour name or label | `COLOR_NAMES`, `COLOR_LABELS` | `src/lib/palette.ts` |
| a checkbox, a table grid, a cell | `.db-check`, `.db-table`, `.db-cell` | `src/app/database.css` |

### The geometry has to match too, not just the path data

Reusing the glyph but not the button is a second near-miss. The established pair is a
**19.5x30** button holding an **18x22** glyph, `border-radius: var(--radius-sm)`,
`color: var(--text-3)`, `background: var(--hover-strong)` on hover — see `.frame-grip` in
`src/app/editor-blocks.css`. If you copy the glyph and then hand-roll the button, you have
moved the disagreement one level down.

The rule that follows: **reuse the component, not its numbers.** `FrameAnchor` renders the
box, the two buttons, the order, the labels and the hover. Its host may only decide *where
it sits* (`inline` versus floating) — that is what `.frame-anchor--inline` is for. If a new
host needs a different colour, size or hover, it does not have a new host, it has a new
component, and that is a decision to bring to the owner rather than to type into a
stylesheet.

### Placing a widget outside its own box: check what clips

Two lessons, both learned by measuring rather than reading:

- `.bn-editor table` sets `overflow: hidden` at `(0,1,1)`, which beats a `.db-table`
  class rule — the same specificity trap as the type scale. Anything positioned outside a
  table's own box is painted into nothing until the table stops clipping.
- A `td` is `.db-cell`, and `.db-cell` clips for truncation. A cell that only holds an
  overhanging control needs `overflow: visible` of its own.

Correct DOM, correct opacity, correct geometry, zero pixels is a real failure state. Assert
with `elementFromPoint`, not with `getBoundingClientRect`.

### Order counts

`FrameAnchor` renders the plus **before** the grip. A second gutter that renders
grip-then-plus is the same two glyphs mirrored: correct in isolation, wrong beside the
first one. When you reuse a pair, reuse its arrangement.

### A drag is `DragLayer`, not a new ghost

A dragged row and a dragged page must look like the same gesture, so the database table
renders `components/drag-layer.tsx` — the ghost under the cursor (`.tree-ghost`, 0.86
opacity, portalled and `position: fixed` so an `overflow: auto` ancestor cannot clip it) and
the insertion line (`.tree-drop-line`). Drawing a second ghost with its own opacity and its
own shadow is the same class of mistake as drawing a second grip: the two are only ever seen
side by side in a review, and the difference is exactly what the owner notices.

### The guard is a test, not a note

`tests/frame-anchor.test.ts` fails if a second file renders `.frame-anchor`, imports the
glyphs, re-declares the pair's CSS, or reintroduces the removed `.db-pair` / `.db-plus`
classes. A note in a document is only followed by whoever read it that session; a failing
test is read by everyone.

### The dev server caches service *instances*, not classes

`src/server/runtime.ts` memoises `RaspberryService`, `DatabaseService` and `FileStore` on the
module. Editing a service class hot-reloads the class and leaves the old instance in place, so
a method added a minute ago answers `is not a function` and the route returns **500** — which
looks exactly like a bug in the new method. Restart `Start-Raspberry.cmd` after adding a server
method, before believing any 500.

