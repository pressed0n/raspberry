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

- **Tests:** 694 passing, 0 failing, across 57 test files.
- **Typecheck:** `tsc --noEmit` clean.
- **Committed through:** `bca9d15` — docs: snapshot at the commit above.
- **Schema:** migrations 1–8.
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
  The hosted copy has **two accounts** at the owner's instruction — two people with a
  workspace each, which is not the multiuser retrofit and does not bring it closer.
- **Hosted, as a new decision.** The 28 October hosting pilot was cancelled and its files
  deleted, and that cancellation stands. On 15 November 2026 the owner took a *different*
  decision — Vercel plus Neon — described under "Hosted deployment". The old plan is still
  not resumption material.
- **"Raspberry Pi" is a name, not a deployment target.** The question is retired.

## What is built

Enough to be concrete without the 42 KB of narrative that used to be here (it is in
`docs/ARCHIVE/BACKLOG.md` if you want the story of any of it):

- **Shell** — sidebar tree with drag-to-reorder and drag-to-nest, page menu, favourites,
  trash with restore and purge, tab strip with keyboard shortcuts, breadcrumbs, settings
  dialog, theming from a data palette.
- **Editing** — BlockNote-based block editor, object selection and clipboard, media
  blocks, clipboard-image paste and drag-in, drafts with optimistic sync.
- **Auth** — an emailed six-digit code, and nothing else required. An address signs in only
  when it is **allowlisted *and* already has an account** (`src/app/api/auth/start/route.ts`
  → `/api/auth/verify-code`): 6 digits from `randomInt`, salted-scrypt stored, single use,
  five minutes, five attempts, `__Host-` cookie bound by a state digest. Google OIDC survives
  as an *optional* second factor — a deployment without `GOOGLE_CLIENT_ID` still signs its
  people in, which is the shape the hosted copy runs. Accounts are created deliberately by
  `pnpm accounts`, never by whoever reaches the form first. The hosted copy **sends**: SMTP
  from `support@preston-labs.com`, with TLS verified against the relay's certificate name
  (`RASPBERRY_SMTP_SERVERNAME`) rather than switched off. See "Hosted deployment".
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

- **B43d — `Date format` next to the picker, not over it; and the list that was being squeezed**
  (this turn). *"When clicking on date format you have those options open over the current
  dropdown ... those options should open next to the dropdown."*

  B43c's body swap was a substitute with an argument, and the argument — 252 + 200 does not fit in
  390 — was true and beside the point. The row is now the app's **one submenu** (`MenuSub`), the
  same primitive as `Sort`, `Decimal places` and the tag colours: right of the row, flipped left
  when there is no room, one hover corridor, one Escape. The picker's pane state,
  `returnToCalendar`, `MenuPaneHead` and `focusMenuRow` are gone from `date-panel.tsx`, along with
  the dead `.db-date-pane` rule; `Status groups` keeps the pane machinery, which still has a test.

  Two things the change needed, both found by measuring:

  | | |
  |---|---|
  | the list was being **squeezed, not placed** | at 1400×900 the row is the last of a 370px panel, so `menuStyle`'s side rule left the surface **164px** of window and drew five of its nine rows — both clocks under a fold. A caller that states `preferHeight` now hangs the surface from the row's **bottom** edge and grows upward: nine rows, ending on the row it belongs to. Submenus that state nothing keep the old placement, which their probes measure |
  | **390 is still arithmetic** | 252 + 200 does not fit, so there the fly-out flips left and lies over part of the calendar — exactly what the tag-colour submenu has always done. Now asserted rather than assumed, at both widths: *"at this width there is no room beside it, so it flips and stays wholly inside the viewport"*. Nothing disappears, which was the pane's actual cost. **And it is not only a phone behaviour**: on the owner's own `Test Database` at 1400×900 the date column sits so far right that the picker ends at x 1195 — 205px of window left for a 200px list plus its 6px gap — so the list opens on the **left**, measured live below |

  Also learned: a fly-out needs **none** of the pane's keyboard repair — the row that opened it is
  still there — so `tests/database-dates.test.ts` now asserts the picker has neither `MenuPaneHead`
  nor `focusMenuRow`, and that the row it imports is `MenuSub`.

  Proof: `scripts/run-dates-probe.ps1` — **77/77 at 1400×900 and 77/77 at 390×844**, disposable copy,
  every claim read back from `/api/databases`. Section 9 now measures the *geometry*: two surfaces
  with the calendar still behind them, the fly-out beside the row it opened (covering none of it)
  at 1400, flipped and inside the viewport at 390, **zero pixels of scroll** inside it, the six
  formats plus `Time format` with exactly the format and clock in use ticked, a clock and a format
  picked there and read back from the server, the tick moving in the same surface, a row never
  opened changing too, and the keyboard unharmed (focus opens the list, focus stays on the row,
  `ArrowDown` still reaches the picker's own rows, one `Escape` closes both surfaces).
  `tests/database-dates.test.ts` adds `menuStyle`'s placements as a pure test — the old squeeze at
  164px, the hang, and the clamp that keeps either one inside the window when the row is against
  the floor.

  And on the **running app** on `:3000`, read-only, on the owner's own `Test Database` (`6/6`):
  the picker is at x 943–1195, the fly-out at x 744–944 — flipped left, clear of the calendar's
  row, `scrollHeight − clientHeight = 0`, one `Escape` closing both, and **0 blocked writes** with
  the column's `config` (`{"format":"ymd",…}`) unchanged.

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

- **B43c — `Date format` where the value is, and a pane that keeps the keyboard** (this turn).
  The ask: *"Date format should also be accessible in the dropdown where you're selecting the
  date … it would change the format for the whole column."*

  The six rows were already written — inside the property menu's submenu. The picker now draws
  **the same component**, and neither surface owns the list:

  | | |
  |---|---|
  | `date-format-rows.tsx` | `DateFormatRows` (the six) and `TimeFormatRows` (the two clocks). Both surfaces import it; `tests/database-dates.test.ts` fails if either file maps `dateFormatChoices` itself, because *importing* the rows and then drawing a copy beside them is the same drift with better manners |
  | `dateFormatLabel` | one lookup in `properties.ts` for "which format is this column on" — `iso` → **Year/Month/Day**, `long` → **Full date**, unknown → **Full date**, the same fallbacks `dateConfigOf` applies. Two rows now say this; a second copy is how they end up spelling it differently |
  | the picker's row | `Date format   Full date ›` at the foot of the panel, under `Include time`, with the caret a submenu wears |
  | pressing it | **it first shipped here as a body swap** — head, divider, six rows, `Time format` beneath when the column shows clocks — on the argument that a 200px surface beside a 252px one stacks on the calendar at 390px. The owner sent that back the same session (*"those options should open next to the dropdown"*): it is a **fly-out** now. See B43d |
  | picking | writes `onConfig({ format })` — the **property's** config, so every row in the column changes — and keeps the surface open, because the person is mid-value. The bound row above the grid re-renders in the new format, which is the acknowledgement that it took |

  **The bug this turn found, in code older than the feature.** Replacing a surface's body
  removes the row that had focus, so `document.activeElement` falls to `<body>` — which is
  *outside* the surface, where `onMenuKeys` (the arrow-key traversal) never hears another press.
  Both panes were pointer-only rooms the moment you opened them, and `Status groups` has been
  that way since B42f. Fixed in the one place both share: `MenuPaneHead` (`autoFocus` on the way
  out) and `focusMenuRow(key)` + `MenuItem`'s `focusKey` (the way back in). Once the picker became
  a fly-out (B43d) only `Status groups` still needs either half, and the test says so in both
  directions: the pane's two halves must be there, and `date-panel.tsx` must have neither.

  Proof: `scripts/run-dates-probe.ps1` — **77/77 at 1400×900 and 77/77 at 390×844**, disposable
  copy, every claim read back from `/api/databases`; section 9 opens the picker, reads the row's
  name and caret, opens the list, checks the six rows and that exactly the format *and* the clock
  in use are ticked, picks a clock and a format there, and then asserts the change on a **row it
  never opened** — that is the "whole column" half of the ask. (Section 9 was rewritten for the
  fly-out in B43d; the keyboard half is now one focus and one `ArrowDown`, because a fly-out
  never takes the row away.)

  Also repaired, in the groups probe: *"the + selects the tag it created"* waited for the
  **option** write and then read the cells — two writes arrive in order, and at 390px the read
  landed between them. It now waits for the cell as well. Waiting for a claim is not the same as
  weakening it: a lost cell write still times out and says so.

- **B43b — Date formats in a person's words, and one width for every dropdown.**
  Two asks: *"add a date format feature"* with six named formats, and *"all our Property
  dropdowns are too wide … Notion's especially the calendar feels better and less clunky"*.

  | format | the cell reads | stored as |
  |---|---|---|
  | Full date | `October 30, 2026` | `full` (**the default**) |
  | Short date | `Oct 30` | `short` |
  | Month/Day/Year | `10/30/2026` | `mdy` |
  | Day/Month/Year | `30/10/2026` | `dmy` |
  | Year/Month/Day | `2026/10/30` | `ymd` |
  | Relative | `Today` · `Yesterday` · `Tomorrow` · `Thursday` · `Last Saturday` · `October 17, 2026` | `relative` |

  Three things were decided rather than typed:

  - **`Relative` takes the day as an argument.** `relativeLabel(day, today)` is pure;
    `dayHead` passes `todayKey()`. A formatter that reads the clock cannot be tested on the
    day that matters — offset 0 — and this one is wrong by one word when it is wrong.
  - **The two retired names still mean something.** `iso` rendered `2026-10-30` and `long`
    rendered `30 Oct 2026`; `legacyDateFormats` reads them as `ymd` and `full`, and
    `configSchemas.date` rewrites them on the way in (`z.preprocess`). Rejecting them would
    blank the format of any column saved before the rename — the owner's own Date column
    stores `iso`, and now reads `2026/10/30`.
  - **The trailing slot stopped being a sample.** `Date format   October 30, 2026 ›` was the
    widest thing in a menu that had to fit a caret and a label; it is now the format's *name*,
    which is what the reference shows and what let the menu narrow at all.

  One width for the whole family, which is the other half of the ask. It was four numbers in
  three files: `240` in the stylesheet (losing to an inline style), `268` at the property
  header, `272` in the tag dropdown, `296` for the calendar — so "how wide is a dropdown" had
  no answer and the widest box in the app was a cell menu. It is now **252** (`MENU_WIDTH`) for
  every menu and the picker, **200** for a side submenu, both in `menu.tsx`, with the
  stylesheet rules that duplicated them deleted. Rows went 30px → 28px, and the calendar's day
  cells 40px → 34px wide.

  Found while measuring, and fixed: **the page title clipped its own descenders.**
  `.doc-title` is a `rows=1` textarea with `overflow: hidden` and `--lh-tight`; at 40px the
  serif's box is ~50px inside a 47.2px line, so the tail of a "p" sat under the padding edge.
  `padding-bottom: 0.06em` gives the ink its room without touching the leading.

  Proof: `scripts/run-dates-probe.ps1` — **55/55 at 1400×900 and 55/55 at 390×844**, disposable
  copy, real presses, each claim read back from `/api/databases`. Section 8 walks all six
  formats through the menu and asserts the stored value *and* the rendered cell; section 9
  measures the widths (252/252) and fails if any menu row ellipsises its own name; `Relative` is
  asserted on a cell holding *today*, so the probe cannot start failing on a date nobody chose.
  `tests/database-dates.test.ts` grew to 24 assertions, including every `Relative` cutoff and
  both legacy names through `dateConfigOf` **and** `configSchemas.date.parse`.

  Also repaired: `run-dates-probe.ps1`'s text-clip step had **never run** — it waits for a tag
  chip on a fixture with no tags, so the runner always exited 1 after the probe had passed.
  The seed now carries a Select column with one tag, and the descender measurement above came
  out of finally running it.

- **B43a — Date: a range, two clocks, and a column that says how it reads.** The ask,
  in four lines: *"Option to choose end date / Include time / Option to just select start and end
  time in one date / Make a better design and UX for it"*. The cell was `<input type="date">`
  — one day, no end, no clock, no control over how the column read, and on Windows a browser
  popup that looked like a different product.

  | | |
  |---|---|
  | `date-panel.tsx` | the trigger (a button, like a tag cell) and the `dialog` surface: both bounds, the six-week grid, `Today`/`Clear`, and the `End date` / `Include time` rows |
  | `lib/database/calendar.ts` | pure and tested without a browser: fixed 6×7 grid, loose time parser (`930`, `9:5`, `9`), the stepper, `orderBounds` |
  | `date.ts` | `dateConfigOf` / `dateBounds` / `dayHead` / `clockText`, and a same-day range that says the date **once**: `October 30, 2026 14:30 → 16:30` |
  | property menu | `Date format` (six formats, named — see B43b) with `Time format` beneath it, and `Include time` as a ticked row |
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

  Proof: `scripts/verify-db-dates.mjs` via `scripts/run-dates-probe.ps1` — disposable copy, real
  presses, and every claim read back from `/api/databases` (a day press, the end, both clocks,
  `Clear`, `includeTime`, `format`). It was 34 assertions here; B43b grew it to **55**, re-run at
  **55/55 on both widths**. `tests/database-dates.test.ts` (22 assertions) pins the grid, the
  parser, the collapse, and two guards by *file scan*: the cell editor no longer contains
  `type="date"`, and the menu's format rows come from `dateFormatChoices` rather than a list
  written in the menu. Re-run after the harness change: tags 17/17 ×2, status groups 44/44 ×2,
  sort 21/21 ×2, reorder 26/26 ×2, submenu 9/9 ×2.

  **The text-clip step in this runner never ran.** It waited for a tag chip on a fixture with no
  tags, timed out, and exited 1 after the probe above had passed — see `TESTING.md`. B43b seeds
  the chip; the step now measures 25 boxes at 1400 and 26 at 390, and it is what found the page
  title clipping its own descenders.

- **B44 — the Checkbox cell: one position, two values.** The owner: *"It's not vertically in the
  center of the cell. an unchecked checkbox has a different position than the checked checkbox."*
  Both were true and both were one cause: the tick was an `inline-grid` rendered straight into the
  `<td>`, so it lived in the cell's **line box** — which is `vertical-align: top` here (4px above,
  12px below), and whose baseline for an `inline-grid` is *the baseline of its contents*, so an
  empty box sat on its bottom edge and a ticked one sat on the `✓`'s baseline, 2.5px lower. It now
  renders inside `.db-check-cell`, a flex row with `height: 100%`: a flex item is blockified, no
  baseline can reach it, and it is centred in the cell's *content* box at any row height. The
  three states (`true`, `false`, untouched `null`) now measure 8/8 with the same top offset, and
  pressing the tick moves it by zero pixels. Reasoning in `DECISIONS.md`; the guard is
  `tests/database-checkbox.test.ts` (4 assertions, both halves falsified on purpose).

  Proof: `scripts/verify-db-checkbox.mjs` via `scripts/run-checkbox-probe.ps1` — disposable copy on
  `:3105`, fresh seed per width, **21/21 at 1400×900 and 21/21 at 390×844**, every write read back
  from `/api/databases`. Read-only on the owner's own page (`Database Test`, four cells: one
  `false`, three `true`): all four measure **8 above and 8 below**, each on its cell's centre
  line, **0 blocked writes**, and the screenshot shows the empty box and the three ticked ones on
  one line.

  Found on the way, and fixed: **the B40/B41 runner was reporting failure as success.**
  `verify-database-b40.mjs` caught its own exception, printed `probe failed: …`, then called
  `report()` — so a run that died at the first step printed `OK: 0/0 passed` and exited 0. Two of
  its steps had been dead for turns. Its catch now records a failing check; that made two real
  failures visible, and both were the probe, not the app: a cold `next dev` outrunning its 20s
  `waitFor: the table` at 1400 (a minute now, plus a page-route warm-up in the runner), and a
  header press at 390 aimed at a column that had scrolled off the page (it now scrolls, and
  asserts the point is *reachable*). Back to **15/15 at 1400 and 9/9 at 390**, which is where
  `STATE.md` said it stood before. See `TESTING.md`.

- **A row opens from its `Open` button, and from nowhere else (B46).** The owner: *"A lot of the
  times when editing different cells i accidentally or even intentionally double click, which
  throws me inside the page ... i should only be able to open up the page by clicking the
  designated open button which we already have."*

  The `<tr>` carried `onDoubleClick={() => onOpenRow(row.id)}` and `.db-row-open { cursor:
  pointer }` advertised it. Three faults with one shape. The handler sat on the element that
  **contains** every cell, so it saw every press and could not tell a rename from a double press
  meant to select a word — which is what a double press *is* in a text field. The pointer cursor
  is the link cue, on a row that is not a link. And the row already shipped a named `Open`
  button, so the double-click was a second route to the same page that nobody could see.

  Now the row element carries no press handler at all, `.db-row-open` is deleted, and
  `entry-icon.tsx` lost the `onDoubleClick={(event) => event.stopPropagation()}` that existed
  only to protect the icon from that handler. `onOpenRow` has exactly one caller, the button.

  Proof: `scripts/verify-db-row-open.mjs` via `scripts/run-row-open-probe.ps1` — disposable copy
  on `:3106`, fresh seed per width, **18/18 at 1400×900 and 18/18 at 390×844**: no pointer cursor;
  a double press inside a text cell leaves the address bar, the table, the caret and the
  half-typed `abc` intact; a double press on a row's name does not open it; a double press on a
  value tick does not open it; a `dblclick` dispatched straight at the row opens nothing; and
  `Open` is `pointer-events: none` until hovered and then opens the row's own page. The runner's
  **`-Before`** switch rebuilds the copy as the pre-fix tree and asserts the probe **fails**
  there — it does, 3/18, with the double press landing on `#fcce28bf…` from `#45703666…` and the
  table gone. Read-only on the owner's own `Database Test` page: 5/5, **0 blocked writes**.

  Found on the way: `browser-session.mjs` had no double press, and two `b.mouse` calls would not
  have been one — Blink dispatches `dblclick` from the **second press's `clickCount`**, so a
  probe that "tests double-click" with two counted-as-one presses never reaches the handler at
  all. `b.doubleMouse` sends `clickCount: 2`. See `TESTING.md`.

  Regressions after the change: B40/B41 **15/15 at 1400, 9/9 at 390** (rerun), checkbox **21/21
  ×2**, dates **77/77 ×2** with text-clip **3/3 ×2**.

- **A URL cell reads as a link and opens from a marked opener (B48).** The owner: *"by default,
  when a link is entered, it should hide the `https://www` part of the link ... there needs to be
  an option on the dropdown to show the full link ... links should also be clickable if they are
  on the URL property cell."*

  Three asks, and only one of them is a formatter. `link.ts`'s `format` drops the scheme, the
  `www.` and a lone root-path slash — **presentation only**, because `coerce` still stores the
  address whole (`example.com` → `https://example.com/`), so a filter, a sort or the MCP surface
  never sees half a link. The measurement that makes it worth doing: the full address is **196px
  of ink in a 159px field** at the default 180px column; the shortened one is **117px**. A link
  cell was clipping the part you recognise.

  `configSchemas.url` gained `fullUrl` (default `false`), which is the whole reason this is not a
  one-line change: the schema was `.strict()` for a type with no settings, so a toggle writing
  that key would have been refused with a 400 — a switch that silently does nothing. The property
  menu gained **`Show full URL`** with a tick, beside `Hide`, writing the *property's* config.

  The cell is the interesting half. The opener is a real `<a href>` — `target=_blank`,
  `rel=noopener noreferrer`, `title` carrying the full address, because the cell cannot — and it
  lives in `url-cell.tsx`, drawn by `.db-open`'s own reveal rule: `opacity: 0` and
  `pointer-events: none` until the row is hovered or something inside it has focus. **The text
  itself does not navigate.** A press in it is how a caret gets into it; that is what every column
  does on that press, and the owner's last turn was the same lesson one gesture earlier. It is
  what the row's `Open` button already established, applied one level down. Read-only tables have
  no field to compete with, so there `UrlText` makes the text the link.

  Two smaller things came out of *looking* at it rather than asserting it: the empty cell's hint
  was `https://` — a *prefix* teaching a scheme the column no longer shows — and is now
  `example.com`; and the mark was drawn a shade greyer than the `Open` button it is the sibling
  of, so it now carries the same `var(--text)`.

  Proof: `scripts/verify-db-url.mjs` via `scripts/run-url-probe.ps1` — disposable copy on
  `:3107`, fresh seed per width, **30/30 at 1400×900 and 30/30 at 390×844**, every claim read back
  from `/api/databases`: the cell reads `example.com/docs` while the row still holds
  `https://www.example.com/docs`; a typed `newsite.test` is stored as `https://newsite.test/` and
  read back bare; the empty cell offers nothing to open; the mark is invisible **and untakeable**
  at rest, then on the cell's centre line 4px from its right edge; a **double press on the words**
  leaves the page and the caret where they were; **pressing the mark opens the address as a new
  page target at the browser's debugging port** while this page and the caret stay put; and
  `Show full URL` exists once, is off, writes the column's config with every cell byte-identical,
  flips the cell to the full address as the tick moves in the surface that stayed open, and flips
  back. `-Before` rebuilds the copy with the formatter reverted and the mark always clickable and
  the probe **fails, 22/30**, naming eight checks.

  Found on the way, and worth the space: **the first version of the fits check was a lie that
  passed.** It measured the cell's ink with a canvas — in the field's own computed font — but it
  grabbed the `<td>` instead of the `<input>` (`CELL(...) ?.querySelector(...)` binds the `??`
  before the member access), so it measured the string `"undefined"` and reported `62px`, which
  looked plausible. The tell was the caption printing `reading undefined`. It now says
  `117px of ink in 159px of field, reading "example.com/docs"`, and on the pre-fix tree
  `196px of ink in 159px`. **A measurement is only a measurement if its output names what it
  measured.**

- **The two openers stay opaque with the pointer on them (B48b).** The owner, on the URL mark:
  *"the button to open the link is covering the link which is good but on hover i can see the text
  behind it when it overlays it."*

  One CSS fault, in two places, and it is a shorthand trap. The mark was filled with
  `background: var(--surface)` and its hover state was `background: var(--hover-strong)` —
  `rgba(255,255,255,0.07)`, in both themes. `background` is not a second coat of paint over the
  fill; it **replaces** it. So the fill became a 7% white wash, and a wash is transparent: the
  address under the box read through the box at exactly the moment a person reached for it. The
  row's `Open` chip — the same control over the end of the name — had the identical line and the
  identical bug. Both now keep `background-color: var(--surface)` and tint the hover as a
  `background-image: linear-gradient(…)` layer.

  This is the bug that computed style cannot see: `getComputedStyle` would have reported
  `rgba(255,255,255,0.07)` and a style assertion would have nodded. It is measured as paint —
  `browser-session.mjs` gained `b.pixel(x, y)`, a 1×1 screenshot decoded to an RGB triple in the
  **viewport** space every caller's `getBoundingClientRect()` speaks (`Page.captureScreenshot`'s
  `clip` is in page coordinates, which was measured rather than assumed). A saturated patch is
  drawn in each control's own box, under it, and three interior pixels are compared with the patch
  and without: **0/255 difference** over both openers, at both widths. With the fix reverted the
  same three pixels read `38,37,37 → 255,18,18` — 217/255 — and the screenshot shows the address
  through a pink box.

  Proof: `scripts/verify-db-url.mjs` § 2b, **30/30 at both widths**, `-Before` **22/30**;
  `tests/database-url.test.ts` pins it structurally, and was falsified by restoring the shorthand
  (it fails by name); read-only on the owner's own `Database Test` page: **3/3**, mark and `Open`
  both **0/255**, **0 blocked writes**.

  Also fixed in the probe: the "cell reads the full address" check read the cell in a *separate*
  evaluation from the one it captioned, so it could assert the short form and print the full one —
  a failure that reads as a pass. It reads one value until it settles and reports that value.

- **The Place column is a search engine, and a picked place carries its point (B49).** The owner:
  *"whenever a user clicks on a cell a dropdown appears. The cell is now basically a search engine
  for addresses and locations ... the queries show immediately as a new letter hits the cell."*
  And underneath it, the constraint that shaped the data: *"later we will add a map view for the
  database so this is an important part to build the right infrastructure."*

  **The value has two shapes, and the second one means something.** `"12 Rue de Rivoli, Paris"` is
  a typed address. `{ address, name?, lat, lng, id? }` is a picked place, and the record means
  *this place has a point* — a record without one is coerced back to the string, so a filter, a
  cell and a map cannot disagree about the same row. This is a reversal of what `place.ts` said
  when it shipped ("coordinates go in metadata, not inside this value"), and the map view is the
  reason: a map needs one point per **row**, a row's data is its cells, and a point kept in a
  side-property would be edited out of step with the address the first time somebody types over
  one. `placeCoordinates(value)` is the map's whole entry point, and it answers `null` for a typed
  address rather than plotting 0,0 in the Gulf of Guinea.

  **The only outbound request in the app lives on the server.** `src/server/places.ts` — one
  endpoint, a ten-minute `globalThis` cache, `Raspberry/0.1` as the user-agent, a 4s timeout,
  `PlaceServiceError`, and `/api/places/search` in front of it with its own 180/min bucket (the
  one route whose call rate is set by a person's typing). A browser-side fetch would have been
  twenty lines shorter and would have sent the owner's IP, every half-typed home address and a
  user-agent we do not control to a third party. **The provider is Photon, not Nominatim**, and
  that is a policy rather than a preference: OSM's Nominatim usage policy forbids "auto-complete
  search" outright, which is the entire feature. `RASPBERRY_PLACES_URL` moves the endpoint and
  `off` disables it; the probe runs against a loopback fixture for exactly that reason.

  **A keystroke is not a request.** 260ms of quiet, two characters minimum, a one-minute memo on
  the client and a ten-minute cache on the server, `AbortController` on every superseded query
  (or a slow first answer lands under a fast second one), and an empty answer is cached — "nothing
  is called that" is a real answer, and re-asking it on every backspace is how a free service gets
  withdrawn. A *failure* is never cached.

  **The field is the search box**, which is the only part of this that is a design decision rather
  than a data one. A press puts the caret in (that is how the URL cell's lesson generalises: a
  press on the words of a cell is how you edit it), and a `role="listbox"` `MenuSurface` hangs off
  the field with the focus **never leaving it** — the arrows walk the results through
  `aria-activedescendant`, `Enter` takes the highlighted row, `Tab` commits what is typed. The
  first `Escape` dismisses the list and leaves the caret; the second gives the cell back its
  value. It is `open` on press *and* on focus, and the press half is not redundant: after a pick
  the caret is already in the field, so the next press fires no `focus` event — a cell that opened
  on focus alone was a cell you could not reopen without clicking away first (found by the probe,
  not by reading the code).

  **Every state that is not a result still offers `Use "…"`**, because this column was freeform
  text before it was a search engine: nothing found, search switched off, provider unreachable all
  end in "keep what I typed" rather than in a dead end. `Nothing found for "x"` is about the world;
  `Place search is off` is about this app's settings; `The place service could not be reached` is
  about the network — three sentences, never one empty list, because rendering all three the same
  way teaches a person to retype a correct address. The row sits under a hairline: beside two
  places called *Eiffel*, `Use Eiffel` read as a third place until a divider said otherwise (seen
  in the screenshot, not in an assertion).

  Proof: `scripts/verify-db-places.mjs` + `run-places-probe.ps1`, **44/44 at 1400×900 and 44/44 at
  390×844** against a loopback fixture, every stored claim read back from `/api/databases`; the
  same probe **`-Before`** fails as it must (see B50 for what `-Before` now rebuilds).
  `tests/database-place.test.ts` pins both value shapes, the `[lng, lat]` order, the
  name/context split, the three-key de-duplication, `fits` reading the address rather than the
  record, the endpoint resolution and the cache. Also fixed on the way: a Place column had **no
  default icon** (`DEFAULT_PROPERTY_ICON` fell through to `text`), so it now wears `map-pin` in its
  header and in its own result rows.

- **Search results are ranked here, not taken from the provider in the order it sent them (B50).**
  The owner: *"Search doesnt work the best yet ... Querrying 'Rašica 53' — on Notion the first
  result is 'Rašica 53, 1315 Velike Lašče, Slovenia'; on Raspberry the first result is '53 Rašice'
  in Slovakia. Querrying 'Grahovo Brdo 1' — on Notion the first result is 'Grahovo Brdo 1, 6210
  Sežana, Slovenia'; on Raspberry the first result is 'Turistična kmetija Mahnič' which is
  technically on the right address but display name is not right. Ofcourse I dont want you to fix
  just those 2, they are just showing that there is a global problem that needs fixing."*

  **What the data actually contains was measured first, because two complaints turn out to be two
  different problems.** Overpass, `addr:street=Rašica` inside Slovenia: the street has **two mapped
  addresses in the whole country**, 40 and 12a. House 53 is not in OpenStreetMap, so no OSM-derived
  geocoder can return Notion's row — Notion is not one. That is why this turn can only put the
  village on top and **B51** is what puts the address there. `Grahovo Brdo 1` *is* in OSM as a
  single node tagged `name=Turistična kmetija Mahnič`, which is why the answer was right and the
  *label* was wrong.

  **So an address-shaped query is asked twice.** `Rašica 53` is a name and a door on it. Photon
  treats the trailing number as the thing to satisfy and lets the name go fuzzy — the real top ten
  for that query were ten streets ending in 53 across five countries, and the village was not in
  it. Asked as `Rašica`, the same index answers correctly and instantly. `providerQueries` therefore
  sends the query as typed (which finds the door when the door exists) *and* without the number
  (which finds the street it is on when it does not), and the two answers are merged into one pool.
  One pass failing does not lose the other.

  **Then the pool is scored**, in `place.ts`, which is pure and testable: folded exact match 1.0,
  typing-forward 0.9, token-prefix 0.85, all-tokens 0.7, and a Sørensen–Dice similarity **capped at
  0.45** when the query was an address — a near-miss name is a different word, and the number alone
  cannot tell two countries apart. On top of that: a house number that disagrees is a different
  door (−0.65), a result with no number at all is the street it is on (+0.12), and the best
  *credible* row decides a **country** that gets a small lift, which is how the Slovenian rows come
  up together. A relevance floor drops the different-country near misses — **for address queries
  only**, because a name has no such failure mode and searching "Eiffel" should still offer the park
  at its foot (that distinction was found by breaking the Eiffel assertion, not by reasoning).

  **A row's bold line is whichever field answered the query.** `Grahovo Brdo 1` now heads with the
  address and puts the farm on the dim line, keeping it in the stored `name` — one place, two
  sentences: `Grahovo Brdo 1` (where it is) and `Turistična kmetija Mahnič, 6210 Sežana, Slovenija`
  (what else is true of it). The address itself is the postal line, with the farm's name not in it.
  The **word order repeats what was typed**: Slovenia writes the street first, France the number
  first, and a Photon answer has no formatted address to borrow — so the order of the query is the
  only signal available. And when a house number is typed and nothing carries it, this turn's
  surface says `No house 53 in the map data — these are the places around it`; **B51** replaces
  those rows with the address that was typed and rewrites that sentence.

  **The provider is a free service and was treated like one, after it cut this machine off.**
  Measured: about twenty requests inside two minutes and the public Photon instance stopped
  answering at all — 503, then TCP timeouts, for hours, while Nominatim and example.com kept
  answering in under a second. So the typing pause went 260ms → **380ms**, an address query is
  still at most two requests, a 5xx is retried **once** (a refused connection is not briefly busy
  and is not retried), a **circuit breaker** opens after three consecutive failures and stops asking
  for thirty seconds, and a stale cache answer (up to an hour old) is used in place of an error.
  `/api/places/search` now answers **503 `places_busy`** separately from **502
  `places_unavailable`**, and the cell says "busy — try again in a moment" rather than implying the
  person's address or network is wrong. Verified on the live dev server while the provider really
  was blocked: `Rašica 53` → 502 in 4076ms, the next query → 503 in 12ms.

  **One bug this turn created and then killed.** The cache is parked on `globalThis` so a hot reload
  does not cold-start it, which means it outlives the shape of the file that wrote it: entries from
  the previous version (`{ at, hits }`) have no `features`, so every search answered "nothing
  found" on the live server until the process restarted. Caught by calling the live route instead
  of trusting the tests, and fixed by refusing an entry that no longer has the shape of an answer.

  Proof: `run-places-probe.ps1` **44/44 at 1400×900 and 44/44 at 390×844** as it stood at this turn
  (the same file scores 50/50 after B51, which added six checks) — including the two questions
  reaching the fixture, the Slovenian village first, no row from another country, the `No house 53`
  note, and `Grahovo Brdo 1` heading with the farm on its dim line. The same probe **`-Before`**
  (ranker neutered: provider order, own names) scored **39/44** and its five failures printed the
  owner's exact complaints — `{"name":"Rašice 53","context":"982 62 Rašice, Slovensko"}` and
  `{"name":"Turistična kmetija Mahnič","context":"Grahovo Brdo 1, 6210 Sežana, Slovenija"}`.
  `tests/database-place-ranking.test.ts` — 16 assertions against the rows Photon really returned,
  plus `providerQueries`, the two-pass merge, the breaker, the stale answer and the shape-checked
  cache entry.

- **A typed house number is never dropped: the address is composed onto the road that number is on
  (B51).** The owner, on the result of the ranking: *"Its still not perfect ... Querry doesnt give
  Rašica 53, only Rašica. Palmejeva ulica 28 doesnt get shown on the querry either."*

  **`Palmejeva ulica 28` was measured before anything was changed, and it already worked** — the
  live route answered `{"label":"Palmejeva ulica 28","context":"1000 Ljubljana, Slovenija"}` in two
  rows, and Photon has that door (`type=house, osm_key=building, housenumber=28`). Whatever the owner
  saw, it was not the ranking: the likely cause is the provider having been blocked at the time
  (`STATE.md` B50 — it cut this machine off for hours), which the cell reports as *busy*. No code
  was changed for it and the probe now pins the answer.

  **`Rašica 53` is not findable, so it is composed.** House 53 does not exist on that road in
  OpenStreetMap, so no ordering of the provider's rows can produce it. Instead: when the number is
  typed and **no** result carries it, the rows become the address that was typed, anchored to a
  place that could plausibly hold it. Two rules decide the anchor, and both are about what a house
  number is — a door is an address **on a road**, so roads are what is looked at; and a road name
  exists in many settlements, so the road is read **where most of that name's own roads are.**
  Measured: `Rašica` returns four roads in Velike Lašče and two in Ljubljana, and the only two houses
  the map really has on that road (40 and 12a) are both **1315 Velike Lašče** — which is exactly the
  postcode Notion shows, arrived at from data rather than by hard-coding it. The second row is
  `Rašica 53, 1217 Ljubljana, Slovenija`, because which village somebody means is not knowable here
  and offering both beats being confidently wrong.

  **The point is the road's, not the door's, and the value says so.** `approx: true` rides on the
  hit and into the stored value (`PlaceValue.approx`), `placeReading` exposes it as
  `approximate`, and `coerce` **keeps** it — a `coerce` that dropped it would turn a road back into
  a doorstep on the way through the server. The map view is the reason: a marker whose point is a
  road centroid must not be drawn like a door. The cell still reads only the address, because an
  approximation is still the address somebody typed. The surface says
  `No house 53 in the map data — it is placed on the road, not the door`.

  **A landmark is not an address space.** `addressable` allows roads, and settlements when no road
  is in the answer at all — so "Eiffel 1" keeps the tower and the park beside it instead of
  inventing "Eiffel Tower 1". `readQuery` also gained `numberText`, the number as typed, because a
  composed row repeats the address back and `12A` is not `12a` to the person who typed it.

  **Two rules were falsified before they were trusted**, by mutating the source and watching the
  named test go red: dropping the settlement count from the group order (the first row becomes
  Ljubljana) and counting every addressable row instead of roads only (three Ljubljana districts
  outvote one Velike Lašče road). Removing the `approx` from `coerce` fails the storage test by
  name; allowing a landmark as a host fails the tower test and the neighbours test.

  Proof: `run-places-probe.ps1` **51/51 at 1400×900 and 51/51 at 390×844** — the first row is
  `Rašica 53`, it is placed at `1315 Velike Lašče` and the Ljubljana row is beside it, pressing it
  stores `Rašica 53, 1315 Velike Lašče, Slovenija` **with a point and `approx: true`** read back from
  `/api/databases`, the cell then reads that address, and the surface is the map card (B52). The same probe
  **`-Before`** (ranker neutered *and* the composition removed) scores **40/51** at both widths, and
  two of its failures print `{"name":"Rašice 53","context":"982 62 Rašice, Slovensko"}` — the owner's
  complaint, reproduced. `tests/database-place-ranking.test.ts` grew to 19 tests (three of them
  new) and `tests/database-place.test.ts` to 15; **560 passing**, `tsc` clean, `check-docs --full` OK.

  **What is still not Notion.** Nothing about this makes OpenStreetMap have the door. The row is the
  address plus the road's point; a real reverse geocode would say "somewhere on Rašica". The next
  honest step is the map view, which reads `placeReading(value).approximate` and draws the two kinds
  differently — that is the infrastructure this turn built.

- **Picking a place turns the dropdown into a map of it (B52).** The owner, with two screenshots:
  *"When I do select a location in notion, the dropdown gets overwritten by a map with a pin on my
  selected location ... lets implement that too on Raspberry."*

  **The surface now has two shapes, and which one you get is not a mode.** `placeCard()` in
  `property-types/place.ts` answers a card or `null` from three facts: the value has a point; the
  field still reads that address; and a pick whose write is still in flight wins over the value the
  server has not echoed back yet. Because it is derived rather than stored, typing one character
  turns the map back into the list on its own — there is no "which view am I in" flag to get wrong.
  A cell holding a *typed* address still opens the list, because a sentence is not a location.
  Picking no longer closes the surface: the list is *replaced*, which is the reference behaviour.

  **The squares come from this app, not from OpenStreetMap.** `/api/places/tile?z&x&y` →
  `src/server/tiles.ts` → `RASPBERRY_TILES_URL` (OpenStreetMap by default, `off` to draw the pin on
  a plain surface and say so). An `<img src="https://tile.openstreetmap.org/…">` is twenty lines
  shorter and puts the address somebody just picked into a stranger's log four times per cell, with
  a user-agent we do not control — which is exactly what OSM's tile policy exists to stop. The proxy
  also keeps a byte-budgeted `globalThis` cache, checks the content type (a 200 carrying an HTML
  "slow down" page is not a tile), and does **not** retry: a view is four squares and a missing one
  is a hole, not a lost answer.

  **The arithmetic is a library, because the map view is next.** `src/lib/geo/mercator.ts` is the
  projection and the tile grid; `src/lib/geo/preview.ts` is only the *policy* — a 226×150 box, at
  z16 for a door and **z15** for a composed address, because a road centroid must not be drawn as
  confidently as a door. No React and no fetches in either, so the database map view can import the
  first and write its own second.

  **One bug was found by looking, not by asserting.** The mark's `×`, the credit and the arrow all
  worked; the map did not. `filter: invert(1) hue-rotate(180deg) brightness(.92)` made every street
  a black line on a near-black ground — the standard dark-mode trick for a light basemap, which at
  this size and contrast produced a rectangle of noise. Measured by rendering four variants at 3×
  and comparing them; the shipped one is `invert(.9) hue-rotate(180deg) brightness(1.18)
  contrast(.82) saturate(.55)`, and the light theme turns the filter off entirely. The `×` also wore
  a boxed 28px border because the class was written without `db-menu-back` — visible only in the
  screenshot.

  Proof: `run-place-map-probe.ps1` **34/34 at 1400×900 and 34/34 at 390×844**, against a geocoder
  fixture on :3118 and a **tile fixture on :3119 whose squares encode their own `z/x/y` in their
  pixels** — so "which square is where" is a measurement, not a picture, and a square drawn one
  position off fails by name. It also proves the negative: **every request the page made stayed on
  this machine**, and with the route made to answer `503 tiles_off` the card says the tiles are
  switched off rather than that the map is broken. **`-Before`** (the card removed, the list closed
  on every pick) scores **10/34** and prints the old behaviour verbatim: `card false, role
  "listbox", rows 2` and `1 searches: […q=Eiffel%20Tower…]`. `run-places-probe.ps1` was re-run with
  tiles off and its two "a pick closes the surface" claims rewritten for the card: **51/51 ×2**.
  Tests: `tests/geo-mercator.test.ts` (13), `tests/database-place-tiles.test.ts` (8) and seven new
  cases in `tests/database-place.test.ts` — **588 passing**, `tsc` clean, `check-docs --full` OK.

  Two things this deliberately does not do: it does not make the **map view of a database** (that is
  B53, and it is why the arithmetic is a library), and it does not add a **keyboard route to the
  card** beyond Tab — the field keeps the caret, so the arrows and Enter still belong to the table.

- **The way out of a place is Google Maps, asked in coordinates (B52b).** The owner: *"for the
  external link to open it in 'openstreetmap' we could probably do it so it opens in google maps
  since its probably just a link with the address right?"*

  The corner arrow went to `openstreetmap.org/?mlat=…&mlon=…#map=…`, a URL that only parses for
  somebody who already knows what OpenStreetMap is. It now goes to
  `https://www.google.com/maps/search/?api=1&query=lat,lng` — Google's documented keyless form — and
  the tooltip and the accessible name say *Google Maps*.

  **The query is the coordinate, and that is the part of the suggestion that needed answering.** A
  link built from the address is what most people would write, and it is wrong here: Google
  re-geocodes that sentence against its own database, so `Rašica 53` opens on whatever door *Google*
  thinks that is rather than the point the pin was drawn on a pixel earlier — and for a composed
  address we drew the road while Google would have the door. A coordinate cannot be re-geocoded, and
  it cannot be missing: every card exists only because the value holds a point. Six decimals is
  Google's documented maximum (~11 cm), which is what the provider gave us rather than a rounding of
  it.

  `osmLink(point, zoom)` became `mapLink(point)` — the zoom was only ever there for OSM's `#map=`
  fragment. The credit stays `© OpenStreetMap contributors` linked to their licence, because the
  *squares* are still theirs and that is what the licence asks. This is the app's third outside
  destination and the only one that costs nothing at rest: a link is not a fetch, and nothing is sent
  until a person presses it. `.env.example` says so beside the two switches that actually configure
  requests, because "the only one" was already false once.

  Proof: `run-place-map-probe.ps1` **34/34 at 1400×900 and 34/34 at 390×844**, with the `href`
  asserted **whole** and the address text provably absent (`no %20, no +, no Eiffel`). Mutating
  `mapLink` back to the OSM URL fails **exactly one named check at both widths — 33/34** — printing
  the old href, so the check is not decoration. `-Before` re-measured, not assumed: **10/34 ×2**, with
  the link among its 24 failures. `tests/geo-mercator.test.ts` pins the whole string, the clamp
  (`lat 91` → `85.051129`), and that the query is two numbers with nothing escaped;
  `tests/database-place.test.ts` fails if the card spells a Google URL itself instead of calling
  `mapLink`. **588 passing**, `tsc` clean, `check-docs --full` OK.

  One thing this could not do: the owner's live Place column holds **zero cells** (read-only sqlite,
  so nothing was written and there is nothing to reinterpret), so there was no card on their own
  instance to open this turn. The proof is the disposable copy.

- **Files & Media became an upload field (B53).** The owner: *"it should be an upload field that
  holds one or more files. Lets develop it to make it functional and make a good solid and simple
  ux for it."*

  Until this turn the column **was not an upload field at all**. `files.ts` had held the value
  shape since B26 — a list of `{id,name,mime,size}` references into the content-addressed store —
  but `cell-editor.tsx` had no branch for the type, so a Files cell fell through to the shared
  text field: typing "holiday.png" stored a reference to bytes nobody had uploaded, and the cell
  then read back a file that 404s. The fix is a branch, and everything after it is the UX.

  **The cell is a button, and it says what is in it.** One 22px tile — the picture for an image,
  an extension badge (`PDF`) for anything else — then the first file's name, then `+2`. A table
  cell is 120–220px and a row is 32px; five attachments cannot be read there, and a heap of
  thumbnails says "there are some" without saying *which*. `Empty` when there is nothing, which
  is the same word every other empty cell shows.

  **The same surface a tag or a date opens.** `MenuSurface`, 252px, `role="dialog"` because it
  holds a file picker, links and buttons: the count as its head, `Upload` beside it, then a row
  per attachment — tile, name (a real `<a>` to its own bytes, in a new tab), size, `×`. Two ways
  in and both are visible: `Upload` opens the OS picker; dropping files on the cell or the panel
  is the second. Drag-and-drop alone would be invisible — a gesture you already have to know —
  so the empty panel says *Drop files here, or press Upload.*

  **One write per batch, and a refusal does not sink it.** Files go up one at a time through
  `editor/media.ts`'s `uploadFile`, the same function a pasted image uses, each spinner replacing
  the last; the cell is written **once**, after the last one lands, with everything that did. A
  refused file — an empty one, say — is a red line in the surface naming it and the server's own
  sentence, and the files that landed are still committed. **Removing a file removes the
  reference, never the bytes**: the store is content-addressed, the same photo can be attached to
  three rows, and a delete that swept the blob would empty the other two cells. Nothing in this
  app deletes an upload.

  Three smaller things the same pass had to fix: the `Upload` button is `.db-mini-btn`, the
  control `.db-retry` already was (renamed, because a second caller makes a name a lie); the
  cell-as-button box that tags and dates each declared for themselves is now **one selector
  list** with `files` in it — a third copy is exactly the "redraw it instead of reusing it"
  mistake; and a Files column's icon is a **paperclip**, not `Folder`, because a folder in this
  app is a *page container*, the same confusion as the `+` that meant "add a row".

  Proof: `scripts/run-files-probe.ps1` (disposable copy :3110, fresh seed per width) —
  **37/37 at 1400×900 and 37/37 at 390×844**, with the uploads *real*: the probe drives the
  panel's own `<input type=file>` through CDP, then reads the stored value back from
  `/api/databases` and fetches the bytes from `/api/files` and compares them byte for byte. It
  proves the batch where one file is refused still commits the other, that the removed file's
  blob still serves `200`, and that a real `DataTransfer` dropped on a cell uploads like a chosen
  file. **`-Before`** (the `files` branch struck out of `cell-editor.tsx`, so the column falls
  back to the text field) **fails by name at both widths** — *a Files cell has no text field in
  it* — and the runner refuses to start the app if the rewrite did not apply. Regressions re-run,
  not assumed: **dates 77/77 + 3/3**, **tags 17/17**, **b40 15/15 + 9/9**, **row-open 18/18**,
  all at both widths. `tests/database-files.test.ts` adds 12 assertions — the value shape,
  ordering, de-duplication by id, the size and badge helpers, `fileHref` (and a guard that the
  cell calls it rather than spelling the URL), and the two reuse guards above. **600 passing**,
  `tsc` clean, `check-docs` OK.

  One thing this did not touch: the owner's live `Test Database` has **one** Files column and
  **zero** cells in it, so there was no reference of theirs to reinterpret and nothing of theirs
  migrated. Opening their own page with the write guard installed, read-only, passed **6/6**: all
  four Files cells are buttons with no text field, each reads `Empty`, the panel opens as a dialog
  headed *No files* with `Upload`, and **0 writes were attempted**.

- **A file can be saved, and an image can be looked at (B54).** The owner: *"Lets add a download
  button and also if hovering over a file a preview box appears which shows the image (only if an
  image file or svg)."*

  **Saving is a request, not an attribute.** Every type the store shows in place — images, audio,
  video, PDF — is served `inline`, which is right for the name link and wrong for a save. `<a
  download>` would have been one word and would have been a *hint*: the browser may ignore it, and
  it cannot name the file as reliably as the `Content-Disposition` the store already builds from
  the stored name. So `?download=1` asks the store to answer `attachment` for the same bytes, and
  `fileDownloadHref` is the only place that spells it. It can only make a response *more*
  restricted: a `.html` upload is an attachment either way. `↓` sits in the same bare 24px well as
  `×`, and **before** it, so the destructive control is still the last thing a pointer travelling
  off the row meets.

  **The preview is one rule, and it is `isImageFile`.** The ask — "only if an image file or svg" —
  is a single condition, because `image/svg+xml` already starts with `image/`. Giving the peek its
  own list of types is how the tile and the preview drift apart six months from now, so
  `tests/database-files.test.ts` fails if a mime prefix appears in `file-peek.tsx` at all.

  **It is not a menu, and the arithmetic is a library.** `src/lib/peek-place.ts` holds one rule —
  right of the row, flipping left when the right would leave the screen, vertically centred then
  clamped — with no pointer offset, because a peek appears after a rest and must not trail the
  cursor within the row. The component adds only the anchor's rect and the 300ms delay. It is
  portalled to `document.body` (the panel clips and scrolls), `pointer-events: none` (a box under
  the pointer that could be hit would close itself and blink), and `aria-hidden` (the row already
  says the name, the size and the badge). Both call sites use it: a row in the open list, and the
  22px tile in a closed cell — hovering the *button* does nothing, since that press opens the
  panel and a preview on the way would cover it.

  Proof: `scripts/run-files-probe.ps1` — **47/47 at 1400×900 and 47/47 at 390×844**. It reads the
  `Content-Disposition` of both URLs *from the page* (the save is `attachment; filename*=…` with
  the stored name, the view still `inline`), then hovers a real row with a real `mouseMoved`,
  waits longer than the feature's own delay, and asserts the box's rect (on screen, beside the
  panel rather than over it at 1400), its picture (`naturalWidth > 0`), its caption, and its
  computed `pointer-events`. A PDF row produces **no box at all**, and leaving the list takes it
  away. **`-Before`** now reverts *this* turn — the save link back to `fileHref`, both `<FilePeek>`
  renders to `{null}` — and fails **7 of the 10 new checks** by name at both widths (40/47). The
  three that still pass are the *absence* checks — *a document gets no preview*, *leaving the list
  takes it away*, *it goes when the pointer does* — which a tree with no peek at all satisfies
  trivially. That is written down so nobody reads 40/47 as covering the whole section. (B53's own
  before-tree was measured last turn; reverting it again would make §1 fail and skip the hover
  section entirely.) Regressions re-run, not assumed: **url 30/30**, **row-open 18/18**,
  **checkbox 21/21**, **dates 77/77 + 3/3**, **places 51/51**, each at both widths.
  `tests/peek-place.test.ts` adds 6 — flip, the inclusive gutter boundary, the viewport too narrow
  for either side, the clamp at both ends of a list, whole pixels — and `tests/files.test.ts` adds
  the `download=1` disposition with its name. **609 passing**, `tsc` clean, `check-docs --full` OK.

  Two things worth knowing. The probe's screenshot was the only check that could say whether the
  box *looks* like a preview, and it is kept deliberately (`artifacts/shots/files-peek-*.png`).
  And at 390px the peek can only overlap the panel — hover is not a phone gesture, so that branch
  is a guard, not a design.

### B55 — the Formula property (the expression language, and the editor that writes it)

*"Lets work on the Formula property now, It currently does nothing. In notion when I open it, a big
dropdown opens up. Analyze it, design it and develop all the features."* Six screenshots of Notion's
editor came with it, which is the specification.

**It really did nothing.** `cell-editor.tsx` had no branch for the type, so a Formula cell fell
through to the shared text field and *stored what you typed* — a number-shaped value in a column the
write path refuses. B39 had settled the type's shape and said the parser would land later. It landed
here, in **`src/lib/database/formula/`**, one module per concern:

| file | what it owns |
| --- | --- |
| `tokenize.ts` | text → tokens, with source offsets (the highlighter paints the same tokens) |
| `parse.ts` | tokens → AST, a Pratt parser; the precedence table is the grammar |
| `values.ts` | the six result shapes and how each prints |
| `dates.ts` | floating dates: add/subtract/between and a token formatter |
| `calls.ts` | the argument readers every function shares, and the one error sentence |
| `functions/*.ts` | General 11, Text 18, Number 27, Date 19, List 8 — **83 functions**, each with docs; the date family is also reachable through Notion's `Date.` prefix (16 aliases) |
| `evaluate.ts` | the tree walk, `prop()`, memoised formula-of-formula, loop detection |
| `catalog.ts` | the editor's list, *generated* from the registry |
| `paint.ts` / `suggest.ts` | syntax colour and "which word is the caret in", both pure |
| `trace.ts` | debug mode: the value of every node, recorded by the evaluator itself |

The language is `if`/`ifs`/`and`/`or`/`not`/`empty`/`length`/`format`/`equal`/`unequal`/`let`/`lets`
plus text, number, date and list families. `and`/`or`/`if` are **lazy** (they take thunks, so
`if(false, 1/0, 2)` is `2`), and nothing is ever handed to `eval` or `new Function` — that is the
binding architecture rule from B38, and the only reading of a formula is through this parser.

Four decisions worth the prose:

**Empty is nothing, not the wrong type.** `prop("Price") * 2` on a row with no price reads *blank*;
a text cell where a number belongs still fails with a sentence that names the argument and says what
it actually was (`add() argument 2 should be a number, but it is the text "two"`). A formula column
that painted an error over the three rows that are fine would be a column people learn to ignore —
the same rule the date functions already follow.

**A formula date is the Date column's record.** `{ start, end? }`, floating, so `formatCell`,
sorting, filtering and grouping all work on a formula date without a second implementation. It also
means a formula result can be *given back* to the date functions unchanged.

**The result is written into the payload, not into sqlite.** `applyFormulas` runs on the server's
read path and puts each computed value in `row.cells[formulaId]`; everything downstream — the table,
the sorts, the filters, the groups, the MCP export — reads `cells[id]` and needs no special case.
Nothing is stored, and §9 of the probe proves the write path still refuses a value for the column.

**The examples in the help are executed.** `previewFormula` runs the example code shown in the
detail pane against the page in the preview strip, so the doc and the answer are the same call; and
`tests/database-formula.test.ts` runs the same examples again and compares them to the documented
result, so a summary that stops being true fails the build.

The editor is `formula-panel.tsx` (a `MenuSurface` at 620px, four bands) plus `formula-cell.tsx`
(a button that joins the shared cell-as-button selector — the *fourth* caller, which is why the test
that guards that box now checks two own-rules). The field is a `<textarea>` with a painted `<pre>`
underneath sharing its metrics, so a half-typed formula keeps its colour; the list is filtered by
the word before the caret and inserts *at the caret*; `prop("` narrows it to columns. Opening on an
existing formula does **not** narrow the list by the last token — the first keystroke starts that.
Debug mode shows the evaluator's own trace, root first, with types.

Proof: `scripts/run-formula-probe.ps1` — **43/43 at 1400×900 and 43/43 at 390×844**, against a
disposable copy on :3111 with three formula columns (`Total`, `Label`, `Open`) and three rows. It
asserts the read path (`80`, `Total 80`, `No`, `14`, `Empty`), that a formula cell is a button with
no field, that the panel opens on the stored expression with the painted layer *exactly* equal to
the field's text, that the categories list in order, that typing `dateB` narrows to one name and
`Enter` writes `dateBetween()` with the caret inside the brackets, that `prop("Du` narrows to
columns and inserts a complete call, that the preview re-evaluates per page, that debug shows `80`
at the top and `40` for the property, that closing commits `prop("Price") + 5` **once** and the cell
re-reads `45` — including the second formula that reads it (`Total 45`) — and that a direct write to
the column is refused. **`-Before`** reverts the read path and the editor branch and fails the first
nine checks by name at both widths, printing the old bug verbatim: an `<input class="db-cell-input">`
inside the formula cell and an empty value. Regressions re-run, not assumed: **files 14/14**,
**properties 30/30**, and the whole suite (below). **622 tests**, `tsc` clean, `check-docs --full` OK.

Three honest notes. **The AI box from the screenshots is absent** — "Write, fix, or explain a
formula…" needs a model this app does not have, and a field that promises a sentence and produces
nothing is worse than a field that is not there. **The list's `map`/`filter`/`find` are absent** for
the same kind of reason: they take a *formula* as an argument, which is a second grammar, and this
turn's contract is a language that is complete for what it does. And **there is no number-format
setting on a formula column** yet: `format()` and `formatNumber()` inside the expression cover it,
and a column-level format is the same decision B43's number display is already parked on.

## Live sync: another device's edit, in about a second (B56)

**The owner's report:** *"On notion if I make a change on one device it will be seen on another
in a matter of seconds ... on raspberry i need to manually refresh the page in order to see the
change. We need to make it fit the same level of standard."*

They were describing a gap, not a latency problem: `src/` contained **no `EventSource`, no
`WebSocket`, no `setInterval`, no `BroadcastChannel`, no `router.refresh`, no `visibilitychange`**
— verified by grep, not assumed. Every screen fetched once and never again, so the true latency
was "until you reload", which is another way of saying the second device was never told anything.

### What it is now

`GET /api/sync?watch=<ids>` answers one question — *has this workspace changed, and what do my
open tabs look like now* — and the browser asks it once a second while the tab is visible.

- **`src/server/sync.ts`** — the digest. Three aggregates: page count / live count / sum of
  `pages.revision`, database count / sum of `databases.revision`, and the workspace's count of
  rows in `mutations` (writes that were applied rather than replayed).
- **`src/lib/sync-stamp.ts`** — turns a digest into *what kind of thing changed*: the page set
  (re-read the list), a page's revisions (reconcile open tabs), or a database (re-read open
  blocks). Pure, so it is unit-tested.
- **`src/lib/live-sync.ts`** — the loop, with clock, timer and visibility injected, so its
  behaviour between ticks is testable instead of waited for.
- **`src/components/use-live-sync.ts`** — mounts it; `focus` and `visibilitychange` both poke it,
  because a tab can become visible without being focused and focused without being visible.

### Why polling, and not a socket

Every process in the hosted shape is a serverless function, and a function cannot hold a
connection open: an SSE endpoint holds one instance per open tab, and a `LISTEN`/`NOTIFY` feed
needs an unpooled PostgreSQL connection per tab as well. The decisive argument is not cost though
— it is that **polling runs identically in `file::memory:`**, so the suite and
`scripts/verify-live-sync.mjs` exercise the code the deployment runs, instead of a branch that
only exists in production.

### Why the digest is aggregates and not a cursor — three designs rejected

1. **`WHERE updated_at > $cursor`** — `updated_at` is written by *the application*
   (`new Date().toISOString()`), and a hosted deployment is several lambdas with several clocks.
   A writer whose clock lags produces a row the reader's cursor has already passed, so the change
   is never reported. Silently and permanently.
2. **A `changes` table with an auto-increment id** — sound, but the DDL differs per dialect, and
   every write path would have to remember to append to it. A path that forgets is a change
   nobody is ever told about.
3. **A per-database tick bumped by every write** — impossible: `databases.revision` is the
   *structural-conflict* token (`databases.ts:169`), so a checkbox tick bumping it would answer
   every structural edit with "This database changed. Reload before editing its structure."

So the comparison is **equality of aggregates, never ordering** — no clock is involved, and no
write can be "before" the cursor.

**The defect this design uncovered, and the test that now holds it:** `patchRow`
(`databases.ts:601`) writes cells with `UPDATE databases SET updated_at=$1` and **no
`revision=revision+1`**, deliberately — so a digest built on revisions alone would have made
every *checkbox, number and date* invisible across devices while page titles worked, which is the
"it works in every column except this one" failure a suite full of revision assertions cannot
see. The receipt count is the only evidence that path leaves, and
`tests/sync-digest.test.ts` asserts exactly that, including that the two revision sums do **not**
move.

### Adopting, without deleting what somebody is typing

`adoptedRemote` in `draft-sync.ts` is the pure decision, beside the existing `adoptedAppend`:
a newer server revision is adopted **only** when the tab has no unsaved work. A dirty tab is
refused and marked instead.

That marking was **wrong on the first attempt and the probe caught it**. It was a `status`, and
the person's next keystroke set the status back to `pending` about 200 ms later — the notice
existed between two keystrokes and nobody would ever read it, and a user typing continuously
would have met only a `409`. It is now `DraftRecord.behind`, a flag that outranks the transient
statuses and is cleared only by an adoption or a successful save.
`tests/draft-stale.test.ts` pins it; `scripts/verify-live-sync.mjs` observes it in a real browser.

### What is proved

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Suite | **690 passing**, 0 failing, 56 files (`draft-stale`, `live-sync`, `sync-stamp`, `sync-digest` are new) |
| `check-docs --full` | OK |
| Two-client browser probe, 1400×900 and 390×844 | **5/5 at both** — A's retitle arrives on B with `performance.timeOrigin` **unchanged** (so not a reload), B is polling (`/api/sync` count rises), B keeps the text it was typing, and B shows `is-stale` |
| The same probe with `/api/sync` deleted (`-Before`) | **fails the two propagation checks at both widths**, printing `second client still shows "Sync probe …"` |

### What is not

- **Concurrent edits of the same page still resolve by revision rejection (`409`).** This makes
  another device's change *visible*; it does not merge two people's paragraphs. That is a CRDT,
  and it is not this turn.
- **The digest is workspace-wide, so it cannot say *which* page moved.** It says "something did",
  and the caller re-reads. The upgrade path, if it ever matters: add a sequence column to
  `mutations` and return the changed ids.
- One open database block may re-read when an unrelated write lands (any receipted write counts),
  which is cheap and always correct.
- The list is re-read for a content-only change at most once every 5 seconds, and not at all
  while a save is in flight — so a title renamed on another device is on screen within that
  window rather than instantly.



## What is next — in this order

The database programme is numbered B38–B55. B38, B39, all of B40a–B40n and the number half of
B43 are shipped, as are B43a–B43d, the checkbox fix (B44), the row's `Open` button (B46), the
URL cell (B48), the Place cell (B49), its ranking (B50), the composed address for a house
number the map does not have (B51), the picked-place card with its map (B52), the card's way out
to Google Maps (B52b), the Files & Media upload field (B53), its save button and hover preview
(B54), and the Formula property with its language and its editor (B55). What follows is what the
code does *not* yet have, verified against disk rather than against a plan:

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
   their picker, their six named formats (Full date / Short date / three digit orders /
   Relative) and their clocks (B43a, B43b). What still has **no control at all**:
   `display: bar|ring`, `color`, `showNumber` and `divideBy` — all four are declared in the number
   type config and read by the formatter. The date half is done.
4. **Views (B45).** Blocked on the view registry: `src/components/database/views/` with
   `viewRenderers: Record<ViewType, ViewComponent>` does not exist, and the API has no
   `POST /views`. Registry first, then view CRUD, then Board, Calendar, List, Gallery.

**Formulas — shipped (B55).** Parser, evaluator, 83 functions, loop detection, errors as values,
the editor. What is *not* in it: the AI box from Notion's screenshots (no model is wired to this
app), `map`/`filter`/`find` (they take a formula as an argument, which is a second grammar), a
column-level number format, and a setting for what an *empty* result looks like.

**The map view.** The owner has said it is coming (*"later we will add a map view for the
database"*) and B49 built the half that cannot be retrofitted: a picked place stores `lat`/`lng`
in the cell, `placeCoordinates(value)` reads it back for any row without a network call, and the
provider's `osm_type:osm_id` rides along as `id` so a marker keeps its identity across a
re-search. What is *not* there: a map provider of its own, a row→point lookup that copes with a
table holding **two** Place columns, and a decision about a Place cell that was typed rather than
picked — it has no point, and the map has to draw that row somewhere or say it cannot. That is a
design question before it is a code one, which is why it is not on this list yet.

B51 added the third kind, and the map view now has three markers to tell apart rather than two:
a picked door (`point`, no `approx`), a composed address (`point` **and** `approx`, because the point
is the road's), and a typed string (no point at all). `placeReading(value)` answers
`{ point, approximate }` so the difference survives to the drawing code instead of being guessed at
from how many decimals a coordinate happens to have.

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

### Genuinely hosting-gated (6)

`B17` callback redirect origin (only manifests behind a TLS proxy) · `B6` remote MCP with
OAuth · `B7` email deliverability (SPF/DKIM/DMARC) · `B8` deployment runbook ·
`B5` session and account management UI (the service methods exist and are tested; no UI
reaches them) · `B16` invites, multiple users.

**`B4` left this list on 15 November 2026.** The PostgreSQL branch of `openDatabase` now runs
under the entire suite against a real Neon server: 625 of 625, with 139 fixture schemas
created on that server — which is the difference between "it ran on PostgreSQL" and "it ran
on SQLite and said nothing". The adapter is no longer unrun code; `tests/schema.ts`'s URL
seam and the CI `postgres` job are what keep it that way.

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

- One user, one workspace, in the sense the top of this file means: the **hosted** copy at
  `https://raspberry-blush.vercel.app` has **two** allowlisted people, each with their own
  workspace, who sign in with a six-digit code emailed to them. That is not the multiuser
  retrofit — no sharing, no presence, no roles beyond `owner`.
- No live collaboration *of the same page*: two people editing one document still resolve by
  revision rejection (`409`). Another device's change is now **visible within about a second**
  (B56) — that is liveness, not merging, and the sentence "concurrent edits resolve by 409" is
  still true.
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

## Hosting: reopened by the owner, 15 November 2026

The third-party subdomain hosting pilot, the NikDTM hosting plan and the cloud VPS migration
stay cancelled. **What the owner decided instead is smaller:** the app runs on Vercel and the
database runs on Neon. That supersedes the "do not resurrect" note for *this shape only* — it
is not a revival of the VPS plan, and it is why this section exists rather than that one.

### What is deployed

- **App:** `https://raspberry-blush.vercel.app` — project `preston-labs/raspberry`, region
  `fra1`, Node 24.x, Next 16.4.3, 31 routes. `.vercelignore` exists so `data/`, `.secrets/`
  and `.tools/` never leave this machine: the CLI uploads the working tree, not the commit.
- **Database:** Neon project `dawn-waterfall-51324335`, PostgreSQL 18, `aws-eu-central-1`,
  database `raspberry`. The app uses the **pooled** connection string (every function is a
  short-lived client); the test suite uses the **direct** one, because a pooler does not pass
  the `options=-csearch_path` startup parameter that `tests/schema.ts` isolates fixtures with.
- **Data:** migrated by `scripts/migrate-to-postgres.ts` — 9,685 rows: 215 pages (21 live, 194
  already in the trash), 3,547 revisions, 5,646 mutation receipts, 78 databases,
  71 properties, 78 views, 19 cells, 28 file rows, 1 user and 1 workspace. Ids are preserved,
  so `RASPBERRY_OWNER_EMAIL` still adopts the workspace on first sign-in — and it is set to
  the owner's address, so **only that address can adopt the notes**; the second allow-listed
  address gets an empty workspace of its own.
- **Bytes:** migrated by `scripts/migrate-blobs-storage.ts` — the 28 file rows, 36,809,021
  bytes, into `raspberry-uploads` on Neon Object Storage at `w/<workspace>/<sha256>`. The
  second run uploaded 0, which is the idempotence claim met rather than asserted. This is the
  half `migrate-to-postgres.ts` cannot move: bytes were never in the database.

### What is verified, and what is not

Verified, not inferred: a Vercel function opened Neon over TLS through the pooler, ran
`migrate()`, wrote, and read the rows back (`{"status":"ok",
"database":true}` on a probe deployment); the whole suite passes against that server; and the
deployed app now **serves**, because authentication is configured — `/api/health` answers
`{"status":"ok","storage":"s3"}`. Before a sender existed the same URL answered `degraded`
and `/` answered `local_only`, and **that refusal was the safe state, not a fault**:
`servesData()` is false until authentication is configured, so an unconfigured deployment
served nobody rather than everybody.

**Uploads are done, and were proved rather than assumed.** Three facts came out of probing the
live endpoint before a line of `src/server/storage.ts` was wired in, and each one changed the
design:

- A **signed** PUT is checked against `x-amz-content-sha256`; a mismatched body is refused with
  `XAmzContentSHA256Mismatch` and nothing is stored. The ordinary upload path signs the real
  hash, so the bucket itself enforces content addressing.
- A **presigned** PUT is refused unless the payload hash is `UNSIGNED-PAYLOAD`. A browser
  therefore *cannot* be bound to a hash it declares — which is why the direct path lands at a
  random key under `i/<workspace>/<uuid>` and `FileStore.complete` hashes the object itself.
  The client's claim about its own bytes is never used.
- `CopyObject` works, so a verified upload moves to its content address without pulling the
  bytes back through the function, and no schema change was needed.

Then the whole path ran against the real bucket on a throwaway database: `store()` → signed
PUT → `serve()` byte-identical → a `bytes=0-9` range returning `206` — `presign()` → a
browser-shaped PUT (200) → `complete()` → `serve()` byte-identical → the same bytes re-sent on
a second presigned key returning **the same id** and cleaning up the duplicate object. A
preflight for the real origin answered `access-control-allow-origin: *`,
`allow-methods: PUT`, `allow-headers: content-type`, which is the thing that decides whether a
browser may talk to the bucket at all. `tests/storage.test.ts` pins the canonical request,
the workspace-scoped keys, and the "the declared size is not the size that is enforced" rule.

**Sign-in now has its sender, which was the last thing between the deployment and its
people.** `RASPBERRY_MAIL_BACKEND=smtp` sending as `support@preston-labs.com` from
`mail.preston-labs.com:465`, with `RASPBERRY_SMTP_SERVERNAME=eh2.neoserv.si` because the
relay's certificate carries the provider's machine name rather than the mailbox's — the
reasoning, and why the other two answers are worse, is in `docs/DECISIONS.md`. Proven against
the deployment rather than a laptop: `POST /api/auth/start` for **both** allow-listed
addresses returned `200` with `expiresAt` exactly 300 seconds out; a non-allow-listed address
returned `403 not_allowed` before anything was sent; `POST /api/auth/verify-code` with no
challenge cookie answered `400 login_expired` and consumed no attempt. Both `login_challenges`
rows show `attempts 0`, `sends 1`, `consumed_at null`, which is the five-minute single-use
rule observed from the database rather than asserted.

**What is not yet proven about mail:** inbox placement. The relay accepted from the Vercel
function (`250 OK` twice), but whether Gmail delivers it to the inbox or the spam folder, and
whether the relay DKIM-signs outbound with the `default` selector the domain publishes, is
decided by the receiving side. The first code somebody actually reads answers that.

**Both accounts are provisioned**, which is the half of the requirement that is not the
allowlist: `nikprestonk@gmail.com` owns the workspace with the 21 live migrated pages and
`tina.mahnic.photography@gmail.com` has an empty workspace of her own, both `owner`.

**Not yet working, in the order it blocks:**

1. **`pnpm backup` dies on PostgreSQL** by design (`src/server/backup.ts` refuses a non-`file:`
   URL). Backups become Neon's point-in-time restore, and the habit of a local `pnpm backup`
   stops meaning anything on the hosted copy.
2. **Rate limiting is per instance** (`src/server/rate-limit.ts`), so it weakens as Vercel
   scales out. `RASPBERRY_TRUST_PROXY` is deliberately **not set**: `callerIp` takes the
   leftmost `X-Forwarded-For` entry, which the caller controls, so leaving it off makes the
   limiter over-limit rather than under-limit.
3. **`B8`, the deployment runbook, is still unwritten.** Two facts it has to record and that
   are currently only here: the Vercel project is **not connected to Git**, so a push does
   not deploy and `vercel --prod` from this machine is the deploy path; and `vercel build`
   emits two Turbopack warnings for the dynamic filesystem access in `storage.ts`'s disk
   implementation, which is unused on the hosted copy but still traced into the output.
4. **Object storage is selected by presence, not by a flag.** `blobs()` returns `S3Blobs`
   when `RASPBERRY_S3_ENDPOINT`, `RASPBERRY_S3_BUCKET`, `RASPBERRY_S3_ACCESS_KEY_ID` and
   `RASPBERRY_S3_SECRET_ACCESS_KEY` are all set — or the AWS names Neon injects — and
   `DiskBlobs` otherwise. Hosted mode does **not** fall back to the disk: `FileStore.storage()`
   answers `503 storage_not_configured`, so a deployment that loses those four values stops
   accepting uploads loudly instead of writing to a `/tmp` that vanishes on the next cold
   start. `/api/health` reports which backend is live as `storage: "s3" | "disk"`.

## Explicitly cancelled

The third-party subdomain hosting pilot, the NikDTM hosting plan, and the cloud VPS
migration. **Do not resurrect without a new decision from the owner.** That decision was
taken on 15 November 2026 for a *different* shape — Vercel plus Neon, described above — and
it does not un-cancel anything in this paragraph.

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

