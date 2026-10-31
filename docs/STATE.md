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

- **Tests:** 499 passing, 0 failing, across 39 test files.
- **Typecheck:** `tsc --noEmit` clean.
- **Committed through:** `f7b7ce2` — feat(database): B42 tags, status groups and dates; B40m/n submenus; B42b-e.
- **Schema:** migrations 1–7.
- **Working tree:** clean.
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
- **The band around a database block (B40i).** The owner's "very small hitbox at the top …
  stuck in that highlighted state until you refresh", reported three times, was two
  mechanisms at once. `selectable: false` had been written in the *config* of
  `createReactBlockSpec`, which BlockNote 0.56 ignores — it builds the node spec from
  `implementation.meta.selectable` — so the database node had always been selectable. And
  the press guard sat on `.db-block`, whose vertical space was `margin`, which is not
  hit-testable: those six pixels (4px margin + `.bn-block-content`'s 2px padding) belonged to
  the editor, so ProseMirror built the `NodeSelection` the guard existed to prevent. The
  flag is in `meta` now, the guard covers the block's whole band, and the block spends its
  spacing as padding. `tests/database-press-guard.test.ts` pins all three;
  `scripts/verify-db-topstrip.mjs` presses all 18 pixels of the band at 1400 and 390 and
  requires neither a selection nor a moved caret (7/7 both).
- **The property row lost its column rules (B40j).** "Lets remove the column dividers/borders
  in the first property row." The visible line was never `.db-th`'s `border-right` — that
  declaration was (0,1,0) and lost to `.bn-editor th { border: 1px … }` at (0,1,1), the same
  cascade that has now bitten padding, fill and weight in this one block. Worse, clearing only
  the right edge would have changed nothing on screen even at equal specificity: with
  `border-collapse: collapse` a shared edge is drawn from whichever of the two competing
  borders is wider, so the neighbour's 1px left edge stands in the same place. Both sides are
  cleared on `thead tr > th`, and the body keeps its separators — those are the table. The
  rule under the property row is now stated once, for every header cell except the zero-width
  gutter (`:not(.db-gutter)`, or the later `.db-th` rule would have quietly given the gutter a
  border it promises not to draw), at `--hairline-strong`: the filler cell had been restating
  its own bottom edge one step lighter, a colour step in the middle of a line the eye reads as
  one. `scripts/verify-db-gutter.mjs` asserts no vertical rule on either side of any property
  cell, the unbroken rule below it, its single colour, and that the body still has its
  separators (25/25 @1400, 26/26 @390); the two-column case — where "no divider" means "no
  line *between* the columns" rather than "none at the end of the last one" — was proved on
  the disposable instance with the seeded `Name`/`Note` table (5/5 at both widths), because
  every multi-property database in the owner's file is on a trashed page.
- **The number column's menu (B40k).** "Dropdown sort feature shouldnt be A to Z, it should
  be low to high and vice versa… Add option to change Number format… Add option to set
  decimal places." Three of those were already in the config and the formatter and reachable
  from nothing, and the sort wording was `"A → Z"` hard-coded in the property menu — a claim
  about the *type*'s comparison, written once, and wrong for eight of the sixteen types. It
  now comes from `sortLabels(type)` / `sortKind(type)` in `src/lib/database/properties.ts`,
  and the arrow beside a sorted header is chosen the same way (`ArrowUpNarrowWide` for
  numbers, dates and checkboxes; `ArrowUpAZ` for text), so the glyph and the word agree. The
  menu gained **Number format** (Number, Number with separators, Percentage, Duration, and
  twelve currencies beneath a heading) and **Decimal places** (Integer through six); both
  report their current setting on the row itself, and every sample is rendered by the real
  formatter through `formatCell` rather than written here, so it is this locale's grouping
  and this column's decimal count. A property's `config` is parsed **whole** by the server —
  absent keys fall back to the type's defaults — so `configProperty` in
  `database-block.tsx` merges the two-key patch onto the config as it stands; without that,
  setting a currency would have silently reset the decimal places. `MenuItem` and `MenuSub`
  both print their sample through `.db-menu-value`. The four format rows carry no sample:
  "Number with separators" is 149px in this font and a right-aligned sample beside it
  truncated the label to "Number with sep…" in a 200px submenu, so the words win and the
  current rendering is reported on the row above. `scripts/verify-db-number.mjs` drives all
  of it with a real pointer — hovering a row, walking across the 6px gap into the submenu's
  portal, and reading the cell afterwards — and asserts no label in any of the three surfaces
   is ellipsised (`scrollWidth` past `clientWidth`, which no text assertion can see): 22/22 at
   1400×900 and 390×844, on the disposable instance (`scripts/run-number-probe.ps1`).
- **The header's chevron out, and a clicked state in (B40l).** "In the first row, the property
  row, i would remove the chevron/arrow signaling the dropdown. However i would add a clicked
  state … now we have a hover state, lets also add a clicked state which is brighter than
  hover." The caret is deleted from the markup, not hidden: it was `opacity: 0` until hover,
  and **`opacity: 0` does not collapse** — it reserved 11px plus a 5px gap on every column all
  the time, so every property name was truncating 16px earlier than it had to. Removing the
  element gives that room back without moving the grid (the label's width is the cell's).
  The "clicked" state is `button.db-th-label[aria-expanded="true"]`, not a class and not
  `:active`: the menu opens on `mousedown` and closes on dismissal, so that attribute — already
  bound to `open` — *is* the click's lifetime. `:active` would flash for one frame and leave
  nothing behind, which is the opposite of what was asked. It fills with `--hover-strong`, the
  established "engaged" step (`.tree-more.is-open`, `.segmented button.is-active`) rather than a
  new token, and at `(0,2,1)` ties the `:hover` rule at the same specificity, so it is
  **declared after it on purpose** — otherwise hovering an open trigger would knock the fill
  down a step and back up. `scripts/verify-db-th-state.mjs` (15/15 at 1400×900 and 390×844,
  read-only) enumerates every `<svg>` in the label and allows only the property icon and the
  sort arrow, so the chevron cannot return under another class; then it takes the pointer
  **off** the trigger and measures, because a state that is really just hover drops back there.
  Both fills are translucent (`rgba(255,255,255,.04)` against `.07`), so the probe composites
  each over the nearest opaque ancestor and compares relative luminance — comparing the
  computed strings would compare alpha, not brightness. Measured on the owner's page: base
  `[13,12,12]`, hover `[23,22,22]`, open `[30,29,29]` — a 7-level step the eye resolves, and
  gone again the moment Escape closes the menu.
- **The submenu you could not reach (B40m).** "When I hover for example on sort and on the right
  another window appears, if I go with my cursor there the window disappears 70% of the time."
  Not random: it was cursor speed. The surface sits `GAP` (6px) off its row's edge, and that
  strip is **neither box** — the topmost element in it is the parent `.db-menu` itself, an
  ancestor, so the wrapper's `onMouseLeave` fired and the surface unmounted before the pointer
  could arrive. One sample past the row's edge kills it; a flick that lands past the strip in a
  single sample survives, which is exactly a 70/30 complaint. The old `mouseleave` was defended
  by a correct observation ("the portal is a React child of the row, so entering it is not a
  leave") that answered a different question, and by `verify-db-number.mjs`, whose four-hop
  crossing lands *past* the gap on its first hop — so it passed on broken code. The wrapper's
  leave handler is gone. While a submenu is open it closes on the first **pointer move** that is
  on neither its row, its surface, nor the strip between them: the strip is a corridor a
  crossing pointer is by definition inside, and every row of the parent menu ends at the row's
  right edge, so a sibling row is *not* in it — siblings still swap instantly, and a grace timer
  would have shown two submenus for the length of the delay. The corridor's vertical span is
  both boxes together, so a diagonal approach to the top of a tall surface is inside it too.
  `scripts/verify-db-submenu-hover.mjs` (9/9 at 1400×900 and 640×844, read-only) asserts the
  dwell, the one-pixel crossing, the crossing back, the diagonal, the sibling swap and the plain
  row, in both directions of the flip — 640 is the width where the surface flies out to the
  **left**, because a fix that only bridged the right-hand gap would pass the wide run. Its
  "leave the menu" step reads `innerHeight` from the page: a requested `1400x900` window is a
  `1378x802` viewport, and a pointer move to a coordinate outside it delivers **no event at
  all**, so a hard-coded `height - 20` measured nothing (`scripts/run-submenu-hover-probe.ps1`).
- **The corner the corridor did not cover (B40n).** Found by the B42d probe, not by the owner: the
  corridor above only helps a crossing that is *horizontal*. Reaching for the second item of a
  submenu, the hand goes right **and down**, leaving the row's 32px band while still ~60px inside
  the parent — neither row, nor surface, nor corridor — and the surface closed. That is every item
  below the first, which in the Sort submenu is three of four, so the next feature would have
  shipped into it.
  `inSafeTriangle` in `menu.tsx` is the Amazon "safe triangle": while the pointer is inside the
  triangle between where it last was **on the row** and the surface's near edge, nothing dismisses —
  plus a direction test, so a hand heading away still closes. A triangle can overlap a neighbouring
  row, so sibling exchange moved from "hoping two surfaces never coexist" to a module-scoped
  `activeSub`: the row that opens last closes the one before it, in the same event, so exactly one
  surface exists at any moment.
  Proved by making it fail first: with the triangle branch disabled the check in
  `verify-db-sort-order.mjs` reports **"1 surfaces still open"** at both widths, and passes with it
  restored. The B40m probe is unchanged and still **9/9 at 1400×900 and 640×844** — including
  *"hovering a plain row closes the submenu"*, which is what the direction test exists to preserve.
- **Tags: Select, Multi-select and Status (B42).** The whole property was a native `<select>`,
  and "completely broken" was accurate: a `<select>` can only choose from options that already
  exist, so nothing could be **created**, nothing could be **coloured**, and on Multi-select a
  second pick *replaced* the first (`[...selected, id]` was built from a fresh Set every time).
  It is now tags: a chip per value drawn from `COLOR_NAMES` (+ `default`), a search field, a
  `Create <name>` row, a tick on the current option, and a `⋯` per option opening rename /
  delete / the ten-colour list. Three bugs found while shipping it are worth more than the
  feature:
  - **`optionIdsOf` read every single-select cell as empty.** `select` and `status` store one
    id as a bare **string**; only `multiSelect` stores a list, and `asList` answers `[]` for
    anything that is not an array. So the chip never appeared and the panel could not tick what
    was already set — while the *stored* value was correct the entire time, which is why it
    survived review. `tests/database-options.test.ts` pins both shapes.
  - **A `MenuSurface` cannot close itself.** It places a surface and registers *neither* the
    outside-press nor the Escape listener; every other menu pairs it with `useMenuDismiss`. The
    tag panel shipped without it, so a press on the page did nothing, the panel stayed open, and
    the next click landed on the surface instead of the cell behind it. The suite now fails if
    that pairing is lost.
  - **A side submenu could be placed past the bottom of the window.** `menuStyle`'s `right`
    branch reserved a flat 120px for the submenu's height; the colour list is 408px, so on a
    1378×802 viewport its lower **177px** sat below the fold — where `elementFromPoint` answers
    `null` and the last colours could not be clicked at all. The panel is now capped to the room
    actually left and scrolls, with a 160px floor that lifts it off its row's top edge if that is
    all there is.
  Also fixed here: arrow keys in *any* menu field no longer jump focus out of the field (the
  search box and the property-name input are both inside a surface whose `onMenuKeys` swallowed
  them). Verified by `scripts/verify-db-tags.mjs` — 17/17 at 1400×900 and 17/17 at 390×844,
  against a disposable copy with a fresh seed per resolution, because it writes.

- **The descender the chip was cutting off (B42b).** "The letter g gets cut off at the bottom
  slightly and I suppose similar letters will have the same bug." Exactly right, and it was
  every descender: g, j, p, q, y and the comma. `.db-tag-name` needs `overflow: hidden` for its
  ellipsis and it *inherited* `line-height: 1` from `.db-tag` — a line box of exactly one
  font-size (13px) for a font whose ascent plus descent is 15px, so the bottom **1.5px** sat
  inside the clip. The name now declares `line-height: 1.4`; because the chip is a fixed 20px
  and line boxes are centred, the baseline works out to `(20 − ascent − descent) / 2 + ascent`
  either way, so the chips did not move by a pixel (still 20.00px tall, measured).
  Two traps here are worth more than the fix:
  - **No DOM check could have seen it.** `scrollHeight` equalled `clientHeight` the whole time:
    ink overflow is not scrollable overflow, so the usual "is it overflowing?" probe answers
    *no*. `scripts/verify-text-clip.mjs` therefore measures font metrics against the clip box —
    `fontBoundingBox*` for the line box, `actualBoundingBox*` for that string's ink — for every
    clipping element on the page, and reports how many it examined so a clean result cannot be
    confused with an empty one. It reads 1.5px on all five chips before and 0 after, at
    1400×900 and 390×844, plus a 12× before/after render to look at.
  - **The probe lied the first time, in the same direction as the code.** It counted lines from
    a `Range` rect and skipped anything it read as "multiline" — but for inline content Chrome
    returns the *font's* text box (~16px), not the 13px line box, so it classified all five
    chips as multiline and reported "nothing clipped". A probe that is quiet has to be proven
    loud: it was made to fail on the reverted CSS before it was believed.
  `tests/text-clip.test.ts` pins it in the suite — resolving the chip's line-height through
  inheritance, insisting the clip and the ellipsis both stay (deleting `overflow: hidden` is the
  tempting wrong fix: it stops the cut and starts a name painting outside its chip), and
  forbidding the shape anywhere else — a rule that clips *and* declares a line box under 1.15em.

- **Reordering tags by the grip (B42c).** "Notion has a 6 dot grip on the left of each tag to
  easily reorder them." It does now: a grip in each option row's left inset, drag to move, plus
  `⋯` → **Move up / Move down** for anyone who cannot drag.
  The interesting part was not the gesture but **who is allowed to draw the dots**. `GripGlyph`
  was pinned to `frame-anchor.tsx` *and* `grip-glyphs.tsx`, so a grip without a plus beside it
  could only be obtained by copying the pair's button — which is exactly how the row gutter ended
  up with lucide's hairlines in the first place, one level down. So the **button** moved into the
  glyph module as `GripButton` (glyph, `mousedown` selection guard, `is-open`/aria, pointer
  handlers), `FrameAnchor` renders it for its grip half, and the pin got *stronger*: no file
  anywhere mentions `GripGlyph` except the file that defines it. The two hosts differ by one
  modifier class only — `.db-option-grip` is added *alongside* `.frame-grip` (as `.db-grip`
  already was), overriding the box to 16×20 and nothing else — which is what "the same control
  at a different size" has to mean if it is to mean anything. My first cut had it *replace*
  the base class, which silently cost the shared transition, the hover colour lift and the
  handle's visibility on a touch screen; the suite now asserts the base class never leaves the
  shared rule.
  Mechanics worth keeping:
  - **The move is a pure function** (`src/lib/database/order.ts`, `moveRelative`/`moveBySteps`)
    because the failure mode is an off-by-one that leaves four tags in *an* order, which no
    screenshot and no "it moved" assertion can catch. Both speak **ids**: the list on screen is
    `matches`, a *filtered* projection, and splicing an index from it would move the wrong tag
    the moment someone typed in the search box — and the write goes to the property, so it would
    persist. Dropping on a row inserts **after** it when travelling down and **before** it when
    travelling up, from one splice; `null` means "no move", so a press that never travelled
    writes nothing.
  - **Armed after 4px**, like the row gutter, so a click on the grip is not a reorder. The row
    under the pointer is found with `elementFromPoint` + `closest('[data-option-id]')`, because
    pointer capture sends every move to the pressed button and the other rows never fire
    `pointerenter` — the same reason the gutter drag works that way.
  - **Filtering hides the grip.** A subset has no index to drop into; Notion hides it too.
  - **Found on the way, and fixed because it is the same bug this menu already had once:** `⋯`
    was per-row state, and `useMenuDismiss` returns early on a press inside *any*
    `[data-db-popover]` — and a second row's `⋯` is inside the first panel's popover. Two colour
    panels sat side by side and the second press looked like it did nothing. The open row is the
    panel's state now (`editingId`), so there is exactly one, and the probe's "Move down is
    disabled on the last tag" is what caught it: it read the *first* row's panel, at the same
    coordinates, twice.
  Verified by `scripts/verify-db-option-reorder.mjs` — **25/25 at 1400×900 and 25/25 at 390×844**
  on a disposable copy, real pointer, re-seeded per resolution, and every claim read back from
  the stored config rather than the DOM (a drag cannot be proved by looking at the list it just
  redrew). The negatives matter as much as the positives: a press that never moves reorders
  nothing *and writes nothing*; the grip is invisible **and** unclickable at rest; revealing it
  does not shift the chip under the pointer that just arrived.

- **Sorting rows by the tag arrangement (B42d).** *"TO the sort function under the Select property
  add the option to sort them in the same order they are manually ordered by the user in the select
  dropdown."* The request was to add an order that already existed: `select.compare` **was** the
  arrangement — `compareOptions` answers with the option's index in the property's config — so
  ascending had been sorting by arrangement all along while the menu called it **"A → Z"**. Only
  one of those could be true, and adding a second item that did the same thing as the first would
  have been worse than either.

  So the arrangement became a direction of its own and A → Z became the name it always claimed:

  | | |
  |---|---|
  | `sortSchema.direction` | `ascending \| descending \| manual` — the field a view stores, so the direction vocabulary lives in `types.ts`, not in the header |
  | `PropertyTypeSpec.order?` | the type's arranged sequence. Present on Select, Multi-select and Status; **absent everywhere else**, which is what the menu reads to decide whether to draw the row |
  | `select.compare` | the tag's *name*; `select.order` = `compareOptions`, the old comparator, unchanged |
  | `multiSelect` | `compare` sorts each cell's names before comparing (a cell stores ids in click order, so `[Apple, Zen]` and `[Zen, Apple]` are one choice made twice); `order` keeps "more tags after fewer", now as the tie-break |
  | `status` | `order` is group position then position inside the group — the only order a board reads in, and nothing alphabetical can reconstruct it |
  | `manual` on a type with no `order` | falls back to `compare`. A direction is a string in a JSON column; an unknown one must never mean "unsorted" |

  The menu puts **Manual order first** for the types that have one — it is the order the dropdown
  itself shows, and A → Z is the derived one — then A → Z, Z → A, Don't sort. The header names and
  draws whichever is really running (`ListOrdered`, the same glyph on the row and in the header),
  and falls back to the ascending wording when the stored direction asks for an arrangement the
  type does not have, because `sortRows` falls back the same way.

  **Two guard tests had to change, and that is the interesting part.** `tests/database-properties.test.ts`
  asserted `select.compare("o2","o1") > 0` — *"Blue sorts after Red because a person put it there"* —
  and the status test asserted group order through `compare`. Those assertions were correct about the
  old design and are now asserted against `order`, with `compare` pinned to the *opposite* answer on
  the same fixture, so the two orders can never silently become one thing again.

  Checked first, because it decides whether this was free: **no stored view in `data/raspberry.sqlite`
  sorts by an option property** (78 views, every sort on `title`), so no table of the owner's reordered
  when the meaning of `ascending` changed.

  Verified by `scripts/verify-db-sort-order.mjs` — **21/21 at 1400×900 and 21/21 at 390×844** on a
  disposable copy, every claim read back from the stored view config as well as from the table. The
  fixture's three orders (arranged · alphabetical · seeded) are all different on purpose: a fixture
  whose arrangement happens to be alphabetical passes with either comparator wired in.

- **The validator that was an hour old (B42e).** *"When I click on the new sort action i get this"* —
  `Invalid option: expected one of "ascending"|"descending"`, against a schema on disk that says
  `["ascending", "descending", "manual"]`. The feature was fine. The **process** was old: the dev
  server had been running since before the schema changed, and `getDatabases()` was handing out a
  `DatabaseService` instance built from the module graph of that earlier evaluation — so the request
  was validated by an enum that no longer existed anywhere except inside that object.

  Why nothing caught it, including me: **every probe starts a new process, and a new process
  evaluates the current modules.** `tsc` passed, 456 tests passed, and the sort probe passed 21/21
  twice — against a copy that had the new enum. `AGENTS.md` had said "restart after adding a server
  method" and that step was skipped, because nothing about the flow *looked* stale. Staleness has no
  symptom until a new value reaches an old validator, and then the bug appears in the newest code in
  the app.

  Fixed at the cause rather than by restarting: both service classes are one stored field, so an
  instance is an allocation and its useful life is exactly the life of the class that built it. The
  parked promises are tagged with that class (`ServiceMemo.from`) and `reused()` rebuilds when a
  reload has replaced it. The database handle keeps its untagged memo — a connection and its
  migrations are not free — so a migration still needs a restart, and `AGENTS.md`, `MAP.md` and
  `TESTING.md` now say exactly that instead of "restart after adding a method".

  Two claims in those documents were also false and are corrected rather than repeated: that editing
  `runtime.ts` clears the memo (`state` is `globalThis`; nothing clears it) and that the instance was
  "memoised on the module".

  Measured on the running server, one request, `direction: "sideways"` (invalid in every version, and
  `patchView` validates the config before its `UPDATE`, so it cannot write): the error listed
  `"ascending"|"descending"` before and `"ascending"|"descending"|"manual"` after, with the probed
  view's config byte-identical either side of it. Nothing of this reached the owner's data: **0 of 78
  views mention `manual` or `sideways`**, and the 14 views that carry a sort all carry it on `title`,
  as they did before B42d touched the vocabulary.
  `scripts/verify-db-sort-order.mjs` re-run after the change: **21/21 at both widths.**
  `tests/runtime-memo.test.ts` holds the rule itself — same class, same instance; replaced class,
  replaced instance; an untagged promise from the old code is rebuilt, not trusted — and forbids
  `??=` on either slot, because that is a memo no reload can ever clear.

- **Editable status groups (B42f).** *"Status property ... is slightly different than select.
  Whole point is that the tags are grouped. Default groups should be To do / In Progress /
  Complete ... Notion has those groups fixed, you cant change them or add more, but I want to add
  those capabilities to rename, add or remove them"* — plus, at creation, *"whether that group
  displays as checker or unchecked"*.

  The data already existed and nothing edited it: `config.groups` was stored, `status.order`
  sorted by it, and the owner's live `Status` column held **`groups: []`** with two tags whose
  `groupId` was `null`. So the work was not a field, it was a **reading**:

  | | |
  |---|---|
  | an empty `groups` | means the three defaults. A column created before this shipped must still draw three sections |
  | a `groupId` that names nothing (null, or deleted) | means **the first group**. Not an error, and never "no group" |
  | the defaults' ids | `grp-todo` / `grp-in-progress` / `grp-complete`, **constants**, so a tag created into "To do" before any group has been saved still resolves after that save |
  | when they become data | on the first **edit**, never on open. Opening the menu writes nothing; the probe reads the property back to prove it |
  | who owns the rule | `src/lib/database/property-types/groups.ts` — `groupsOf` (read), `storedGroups` (what a write carries), `groupIdOf`, `valueIsChecked`, `optionsInGroup`, `pruneOptionValue` |

  `option.ts` now reads through that module too, so the arranged sort and the panel's sections
  cannot disagree — and an ungrouped tag, which used to sort *after* every group, now sorts in the
  first one, which is where it is drawn.

  **The pane.** `Property header → Status groups` swaps the property menu's body (Notion's
  back-arrow pattern) rather than opening a second surface: a popover anchored inside another
  popover is the corridor B40m was spent on, and this repo has already paid for that once. Each
  group row prints its tag count, `+` creates a tag **into that group** (without it a group could
  be made but never filled — the cell dropdown always creates into the first), and the expanded
  panel holds `Rename`, `Displays as checked`, `Add a tag`, `Delete group`. The cell dropdown now
  draws one section per group, and flattens while searching, for the same reason the grip hides
  then: a subset's headings claim more than they can show.

  **The checkbox is a label.** Per the owner: it appears *only* before the chip in the table, and
  means *nothing* functionally. It is `.db-check` — the same box the gutter and the checkbox
  property draw — rendered as an inert `<span>` with `aria-checked` and `aria-hidden`, so both
  states draw and neither takes a click. The flag lives on the **group**, so moving a tag between
  groups changes what its cells draw without a single cell being rewritten (asserted).

  **Deleting a group takes its tags**, and this is the one place a config write also touches
  cells. `patchProperty` now prunes, in the same transaction: any cell holding an option id that
  the new config no longer contains is rewritten without it, and deleted when nothing is left.
  That is a general invariant for Select / Multi-select / Status, not a status special case — it
  is also what stops a plain tag delete leaving rows pointing at nothing. Deleting a group is two
  presses, and the confirm row says exactly what it would take (*"Delete Blocked and its 1 tag"*).

  Every status config write carries **both** lists: the server validates the whole object it is
  handed, so `{ options }` alone would erase the groups and `{ groups }` alone would erase the
  tags. Both call sites are pinned by a test.

  Verified by `scripts/verify-db-status-groups.mjs` (with `scripts/run-groups-probe.ps1`) —
  **29/29 at 1400×900 and 29/29 at 390×844** on a disposable copy, every claim read back from
  `/api/databases`. Two of its findings changed the code rather than the probe: the pane's expanded
  panel was a fourth *flex item* of the group row and rendered outside the surface, and a rename
  field opened holding the old name, so typing appended ("In progressUnderway") — it selects its
  text on focus now. `tests/database-status-groups.test.ts` (13 assertions) holds the readings,
  the prune and the pane's two source rules, and each new guard was made to fail on the un-fixed
  code before it was trusted.

  Not done, deliberately: **group colours** (`color` is in the schema, nothing sets it) and a
  status-specific "display as Select" mode. The owner's live column is untouched — it still has
  `groups: []` and will until the first edit.

- **B42g — the group controls were built in the wrong place, and the summary said otherwise**
  (this turn). *"You said there's a + on the group ... there isnt. Clicking on a group name
  expands it ... it doesnt. There is no way to add a group. There is no way to remove a group."*

  Every word was true — **of the tag dropdown**. The tag dropdown is the phrase the owner uses
  for the cell's tag menu (it is where the reorder grip lives, B42d), and there the group
  heading was a bare `<div class="db-option-group">`: no `+`, no hit target, no `New group`, no
  delete. The controls existed only in `Property header → Status groups`, so an empty group
  (`In progress`, `Complete`) was a **dead end** in the dropdown: no way to put a tag in it.

  | | |
  |---|---|
  | what the owner saw | `div.db-option-group "To do"` — a label, three times |
  | what the docs described | the pane's rows, in the words of the dropdown |
  | what the fix is | **one** editor (`group-controls.tsx`) that both surfaces render; never a second row that only looks like one |

  `useGroupEditor` + `GroupRow` + `NewGroupBlock` live in `src/components/database/group-controls.tsx`.
  The dropdown mounts them with `variant="option"` (heading-sized name, no count, `+` revealed on
  hover and by `(hover: none)`), the property menu with the default. `status-groups.tsx` is a shell.
  Because the dropdown is a *cell*, its `+ → create` also **selects** the tag it just made; the pane
  only adds it. `newOptionId` / `nextColor` / the colour list moved to
  `property-types/option-ids.ts` so the shared module does not import the module that imports it.

  Two bugs the new probe found in this turn's own code, both real:

  - **The config write and the cell write raced.** `+` on a group creates an option *and* (in the
    dropdown) sets the cell to it. `coerce` empties a cell that points at an option the config does
    not have yet, so the two requests are ordered: `await onConfig(...)` before `onCreated`. It lost
    the race at **1400px** and won it at **390px** — the same code, two answers, which is why the
    check is asserted at both widths.
  - **My reproduction lied twice.** `browser_use` dispatches **two clicks per press**, which toggled
    a group open and immediately shut; my first standalone diagnostic then sent two presses of its
    own. Both made "clicking a group name does nothing" look like an app bug. It never was. The
    harness's `b.mouse` is one moved/pressed/released and is the only click this repo should trust.

  `scripts/verify-db-status-groups.mjs` grew **section 9**, which runs the owner's four sentences
  against the dropdown — 44/44 at 1400×900 and 44/44 at 390×844, every claim read back from
  `/api/databases`. `tests/database-status-groups.test.ts` (now 15 assertions) pins that **both**
  surfaces reach the shared editor and that neither draws a heading of its own: that drift is the
  actual bug, so the guard is on the sharing, not on the feature.

- **B42h — "Groups, top to bottom" was furniture, and it was not the only piece** (this turn).
  *"Really? 'Groups, top to bottom' ? ... Whats this fluff text"* — and the question under it:
  *"are you even using the apple-design and emil-design skills"*. Fairly asked: the skills were
  not applied to that pane, and the label is the kind of thing they exist to delete.

  Three findings, all in that one 252px surface:

  | | |
  |---|---|
  | a micro-caps label over the list | spent **21px** (`6 + 11px line box + 4` padding) saying what a vertical list already says — and implied an order the rows have **no grip to change**, so it promised a capability twice over |
  | the back arrow | wore `.db-prop-icon-btn`, the **icon well**: a bordered 28px box. Correct in the property menu's head, where it holds the column icon beside a text field; here it put a box inside a box |
  | the pane head | had **no CSS at all** — a block parent with an inline-flex button and a span, so the arrow and the title sat on whatever baseline the JSX whitespace produced |

  The label is gone and the space it held is now `.db-groups-list { padding: 2px 0 1px }`, so the
  first row sits 6px under the divider at menu rhythm rather than paragraph rhythm. The arrow
  gained `.db-menu-back` — a modifier **alongside** the base class, as `.db-grip` does — which
  drops the border and the fill and keeps size, radius and the hover lift, so `←` and the bare
  `+` on the rows now read as one kind of control. The head is a real flex row with `.db-prop-head`'s
  own `2px 2px 4px` padding, so swapping the menu's body for this pane no longer shifts the head.

  Not changed, deliberately: **"Displays as checked"** in a group's expanded panel. It is wordy,
  but it names a setting that exists and has an effect — that is a label doing its job, unlike a
  heading restating the layout.

  Seen, not asserted: `scripts/run-groups-shot.ps1` boots the disposable copy and photographs the
  pane at 1400×900 and 390×844 (plus the property menu for comparison), and
  `scripts/scratch/crop.mjs` (gitignored, like every one-off) blows a 28px control up 3× so it can
  be judged. Screenshots are
  evidence for a question no assertion can answer — whether the thing looks like it was made on
  purpose.

- **B43a — Date: a range, two clocks, and a column that says how it reads** (this turn). The ask,
  in four lines: *"Option to choose end date / Include time / Option to just select start and end
  time in one date / Make a better design and UX for it"*. The cell was `<input type="date">`
  — one day, no end, no clock, no control over how the column read, and on Windows a browser
  popup that looked like a different product.

  | | |
  |---|---|
  | `date-panel.tsx` | the trigger (a button, like a tag cell) and the `dialog` surface: both bounds, the six-week grid, `Today`/`Clear`, and the `End date` / `Include time` rows |
  | `lib/database/calendar.ts` | pure and tested without a browser: fixed 6×7 grid, loose time parser (`930`, `9:5`, `9`), the stepper, `orderBounds` |
  | `date.ts` | `dateConfigOf` / `dateBounds` / `dayHead` / `clockText`, and a same-day range that says the date **once**: `30 Oct 2026 14:30 → 16:30` |
  | property menu | `Date format` (four formats, the sample on the row) with `Time format` beneath it, and `Include time` as a ticked row |
  | `table-view.tsx` | a date column is born **220px** instead of 180, because `31 Oct 2026 → 1 Nov 2026` is what the column is *for* |

  The decisions worth the words:

  - **A day press writes immediately.** There is no OK. Every other cell in this table saves as
    you go, and a picker that needed confirming would be the one control with a modal's habits.
  - **The calendar writes to the bound you last touched**, and pressing `End date` moves the pen
    to the end — so a range is two presses: start, end. That *is* "select start and end in one
    date", and it is also how a range inside a single day gets made (the second press lands on
    the start's own day, and the end inherits the start's clock so the two do not swap).
  - **`orderBounds` runs before every write**, because the server's `coerce` *drops* an end
    earlier than its start — silently. Swapping keeps what the person pressed; `date.coerce`'s
    refusal is pinned in the tests so the reason cannot quietly stop being true.
  - **`preferHeight` on `MenuSurface`.** The picker is ~380px and it needs all of it: the
    calendar is the tool and the two toggles are at the bottom. Under that much room below, the
    surface now flips above the cell instead of scrolling. Found by *looking* at the first
    screenshot — the panel was cut off mid-list with `Include time` under the fold, and every
    assertion had passed.

  Also fixed, and it invalidates every earlier "at 390" claim: **the probes were never at 390.**
  `--window-size=390,844` asks for a *window*; Windows will not make one under ~500px, and the
  frame takes a bite out of both dimensions — so a run that printed `@ 390x844` measured
  500×746, and `@ 1400x900` measured 1378×802. `browser-session.mjs` now pins the page viewport
  with `Emulation.setDeviceMetricsOverride`, which made two probes fail immediately: both were
  clicking coordinates outside the page on a column that had scrolled off a phone. Both now
  `scrollIntoView` and assert the point is *reachable* before pressing. See `TESTING.md`.

  Proof: `scripts/verify-db-dates.mjs` via `scripts/run-dates-probe.ps1` — **34/34 at 1400×900
  and 34/34 at 390×844**, disposable copy, real presses, and every claim read back from
  `/api/databases` (a day press, the end, both clocks, `Clear`, `includeTime`, `format`). The
  text-clip probe runs on the same seeded page afterwards (3/3). `tests/database-dates.test.ts`
  (22 assertions) pins the grid, the parser, the collapse, and two guards by *file scan*: the
  cell editor no longer contains `type="date"`, and the menu's format rows come from
  `dateFormatChoices` rather than a list written in the menu. Re-run after the harness change:
  tags 17/17 ×2, status groups 44/44 ×2, sort 21/21 ×2, reorder 26/26 ×2, submenu 9/9 ×2.

## What is next — in this order

The database programme is numbered B38–B45. B38, B39, all of B40a–B40n and the number half of
B43 are shipped. What follows is what the code does *not* yet have, verified against disk
rather than against a plan:

1. **Finish the property rail (B40) — two items left.** `Change type`, multi-sort and the
   keyboard model shipped; what is still missing is **property reorder** (no route, no prop)
   and **filter-from-property-menu** (the read path filters, nothing writes a filter). Both
   need a UI decision before they need code — a filter bar is a new piece of chrome, and the
   reorder can be a menu item or a header drag, which are different gestures.
2. **Options and status (B42) — shipped.** Tags, option CRUD, create-on-the-fly, colours,
   **reordering**, **sorting rows by that arrangement** and **editable status groups** (add /
   rename / delete, the checked label, per-group tag creation) are in (see above). What is
   still missing from this group: **group colours** (`color` is stored, nothing sets it) and a
   status "show as Select" presentation mode.
3. **Display semantics (B43).** The number *format* has a UI now: Number, Number with
   separators, Percentage, Duration, twelve currencies and 0–6 decimal places (B40k). Dates have
   their picker, their format menu and their clocks (B43a). What still has **no control at all**:
   `display: bar|ring`, `color`, `showNumber` and `divideBy` — all four are declared in the number
   type config and read by the formatter. The date half is done.
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
- **A column header opens its menu on `mousedown` only**, so there is no `onClick` and
  Enter/Space on the keyboard-focused trigger does nothing. Removing the chevron does not
  change this, but it removes the last passive hint that the cell is a button — so it is worth
  naming. Escape closes the menu; nothing opens it by keyboard.
- The tab strip is empty in server-rendered HTML. No layout shift, but no SSR tabs.
- Nothing verified against a screen reader; mobile checked at 390px by automated probe.
- Authentication has never run against a real mail provider or a public origin.
- **The owner's trash holds ~194 pages created by automated runs, and nobody has decided
  what to do with them.** `data/raspberry.sqlite` contains 16 live pages and 194 soft-deleted
  ones, created 25–30 October by CDP probes pointed at the live instance (repeating
  `Untitled` / `Alpha` / `Beta` / `Ship the table`, batch id `cleanup-1793362212300` among
  them). The live workspace is intact; the junk is all in the trash. **They are not deleted,
  and must not be.** `docs/TESTING.md` forbids deleting pages by pattern, title, date or
  emptiness, and that rule exists because a previous tidy-up destroyed pages the owner had
  written. Emptying that trash is the owner's decision, taken by id, in one explicit batch.
  The write path that produced them is now closed by the live-write guard in
  `scripts/browser-session.mjs`.

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

