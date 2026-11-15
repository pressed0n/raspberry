# How to verify a change

Two obligations, one rule each. Both came from things that went wrong.

1. **Never destroy the owner's data to prove something works.**
2. **Prove it in a real browser, not only in a test** — and prove it with a pixel, not a
   class name.

---

## The unit suite

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;" + $env:Path
node node_modules\typescript\bin\tsc --noEmit
node node_modules\tsx\dist\cli.mjs --test tests/*.test.ts
```

Node and pnpm are **not on PATH**. The portable toolchain is `.tools\node-v24.22.1-win-x64`.
Four seconds for the whole suite; there is no reason to run a subset while iterating and
skip the full run before claiming success.

`tests/schema.ts` is a shared fixture, not a test file. One test file per `src/lib/` module
is the convention (`tests/sidebar-drag.test.ts` ↔ `src/lib/sidebar-drag.ts`).

## Never delete the owner's pages

**Hard rule.** Do not trash, purge, soft-delete, or "clean up" pages in
`data/raspberry.sqlite` — not as tidy-up after a test run, not because they look like
fixtures, not because they are empty or "Untitled".

This was broken once. Dozens of CDP runs created fixture pages in the live database, and
the tidy-up soft-deleted pages the owner had not created. Their words:

> *"you trashed a bunch of my pages. Not cool."*

### How to test without touching their data

1. **Prefer read-only verification.** Drive the UI and assert on geometry, DOM and rendered
   pixels. Writes can be verified by intercepting the request in CDP (`Fetch.enable` +
   `Fetch.failRequest`) and asserting **the body the UI built**. The server side is covered
   by unit tests against `tests/schema.ts`, not against the live file.
2. **If a test must write,** record every id it creates in the same run and delete only
   those exact ids, and only ones that provably did not exist beforehand.
3. **Never** delete by pattern, date, title, emptiness, or "everything with no content".
4. When unsure whether something is yours: leave it and ask.

If an agent run does create litter, say so explicitly and offer to remove it — do not
quietly delete it.

### The disposable instance (when a write must be proved)

`scripts/run-b40-probe.ps1` is the worked example: it copies the project to
`artifacts/qa-run`, starts a second dev server there on `:3100`, seeds it with
`scripts/seed-qa.mjs`, runs `scripts/verify-database-b40.mjs` at both widths, and stops it.
Its descendants follow the same shape on their own ports and directories:
`:3101` / `run-reorder-probe.ps1` (the tag reorder grip), `:3102` / `run-sort-probe.ps1` (the
arrangement sort), `:3103` / `run-groups-probe.ps1` (status groups, seeded by
`seed-qa-groups.mjs`), `:3104` / `run-dates-probe.ps1` (the date picker, seeded by
`seed-qa-dates.mjs`) and `:3105` / `run-checkbox-probe.ps1` (the checkbox cell, seeded by
`seed-qa-checkbox.mjs`), `:3106` / `run-row-open-probe.ps1` (a row opens from its `Open` button
and nowhere else) and `:3107` / `run-url-probe.ps1` (the URL cell and its `Show full URL`
setting, seeded by `seed-qa-url.mjs`), `:3108` / `run-places-probe.ps1` (the Place column's search, seeded by
`seed-qa-places.mjs`, with a fixture geocoder on `:3117`), `:3109` / `run-place-map-probe.ps1` (the
picked-place card, which needs that geocoder **and** a fixture tile server on `:3118`/`:3119`) and
`:3110` / `run-files-probe.ps1` (Files & Media, seeded by `seed-qa-files.mjs`, which uploads real
bytes through `POST /api/files` so the cells point at files that exist). Each re-seeds **per
resolution**, because those probes mutate a property's config or a cell — a shared seed would let
the second pass read the first pass's leftovers.
Three rules make that honest, and each was learned the hard way:

- **`BASE` and `DATABASE_URL` must be set together.** `verify-database-b40.mjs` used to read
  `data/raspberry.sqlite` unconditionally while `BASE` pointed at `:3100` — so it picked a
  page id from the owner's database and navigated the disposable instance to a page that
  does not exist there. The symptom was `waitFor timed out: the table`, which reads as *the
  app is broken*. It now derives the file from `DATABASE_URL`, the same variable the server
  honours, so the two cannot drift apart.
- **The copy is deleted in `finally`, and again at the start of the next run.** A crash skips
  `finally`, and the leftover carries its own `src/` and its own `data/qa.sqlite` — probing
  against it verifies code and data that are not on disk, and reports a green. That is worse
  than a failure. `check-docs.mjs` now fails if `artifacts/qa-run` survives.
- **One dev server at a time.** Two `next dev` processes on one directory fight over `.next`
  and fail in ways that look like app bugs (`Failed to fetch`, `waitFor timed out: the
  shell`). Run the probe with `:3000` stopped, then restart it.

## The browser harness

There is no committed Playwright suite (`B14` is parked). What exists is a set of CDP
scripts in `scripts/scratch/`, one per feature area, each written to answer a specific
question. They are evidence of past runs, not a maintained suite.

**Write new probes against `scripts/browser-session.mjs`** — the one tracked piece. It owns the
spawn, the CDP transport, `waitFor`, real mouse/drag/key input, `shot()`, `requests()` (every
request the page made, for the claims no rectangle can settle), and `check()`/`report()` (which
prints the score and exits non-zero), so a probe is the assertions and nothing else:

```js
import { openBrowser } from "../scripts/browser-session.mjs";

const b = await openBrowser({ url: "http://127.0.0.1:3000/#<page-id>", width: 1400, height: 900 });
await b.waitFor(`!!document.querySelector(".db-table tbody tr")`);
const x = await b.evaluate(`document.querySelector(".db-row").getBoundingClientRect().x`);
b.check("row starts where the page does", x === 24, `x=${x}`);
await b.shot("gutter-1400");
await b.report();
```

The pattern it encodes, learned the hard way:

- Spawn Chrome with remote debugging on a random port (9200 + random 500).
- Use a throwaway profile under `artifacts/.chrome-<port>/` so the owner's session is never
  touched — **and remove it on exit.** 292 probes did not, and the leftovers reached 371,607
  files / 14.6 GB in a gitignored directory, which made a recursive search from the repo root
  time out. `browser-session.mjs` deletes the profile on `close()`, on throw, and on Ctrl+C;
  `scripts/check-docs.mjs` fails if one is left behind. The scratch probes predate this and
  still leak.
- Navigate to `http://127.0.0.1:3000/#<page-id>` — the hash **is** the deep link.
- Drive with real input events (`Input.dispatchMouseEvent`), not `element.click()`.
- Assert with `elementFromPoint` and measured rects; screenshot at the widths that matter.
- Run at **1400, 900 and 390** pixels. Layout compromises are width-dependent: below 860px
  the database gutter deliberately becomes a real first column, and the assertion flips
  with it.
- **The window is not the viewport, and the log line used to lie about it.** `--window-size=390,844`
  asks Windows for a *window*: it refuses to go under ~500px wide, and the frame takes a bite out of
  both dimensions — so a run that printed `@ 390x844` was measuring **500×746**, and `@ 1400x900`
  was measuring **1378×802**. That was true of every probe in this directory until the date picker
  asserted "the panel is inside the viewport at 390" and reported a 500px one. `openBrowser` now
  pins the page viewport with `Emulation.setDeviceMetricsOverride`, so `width`/`height` mean what
  they print. Two probes failed the moment it was fixed — both clicked coordinates outside the page
  on a column that had scrolled off a phone — which is the point: the earlier numbers were not
  wrong about the *feature*, they were measured at a width nobody claimed.
- **Let a throw be a failure.** `report()` ends the process, so `try { … } finally { await
  b.report(); }` turns an exception into a *green run with fewer checks* — the sort probe printed
  "OK: 5/5" while twelve of its assertions had never executed. Wrap the body in
  `catch (error) { b.check("the probe itself ran to the end without throwing", false, String(error?.stack ?? error)); }`
  and keep `report()` in `finally`. A score is only a score if it was possible to fail.
- **Make the check fail on the broken code before believing it passes.** The same probe's diagonal
  check was written after the fix, so the fix was temporarily disabled: `1 surfaces still open` at
  both widths, then 21/21 with it restored. A probe written against working code has not been
  tested; it has been *demonstrated*.
- **Scroll before you click, then hit-test the point.** `.db-menu` is `overflow-y: auto` with a
  460px cap, so a long menu's later rows have rects *outside* the visible box: in the groups probe
  the click for a tag in the fourth section landed on the page and the store never happened — at
  1400px only, because the same menu fits under 460px at 390px. `clickTag`/`clickMenu` in
  `verify-db-status-groups.mjs` now call `scrollIntoView({ block: "nearest" })` first and then
  require `document.elementFromPoint(x, y)` to be the target or inside it — a click that lands on
  the wrong element fails loudly instead of reading as "the feature is broken".
- **Do not put a backtick inside an `evaluate()` template literal.** These probes are strings of
  JS built with backticks, so a comment like `` (`.db-menu` is `overflow-y: auto`) `` ends the
  string and the file fails to *parse* — the error names a line thirty lines down, which reads
  like a corrupted file rather than a stray character.
- **An input that opens holding a value will have your typing appended.** The rename field in the
  groups pane opened with the current name and a caret at the end, so the probe typed
  "In progressUnderway" and every later assertion was about the wrong tag. The fix belonged in the
  component (`onFocus={e => e.currentTarget.select()}`), not in the probe — a probe that
  compensates for the UI is a probe that hides it.

### The live instance refuses writes, in code

`openBrowser()` launches Chrome at `about:blank`, registers a guard with
`Page.addScriptToEvaluateOnNewDocument`, and only then navigates. If the target port is the
live one (3000, override with `RASPBERRY_LIVE_PORT`), every non-GET `fetch` and every
`sendBeacon` is rejected before it leaves the browser:

```
REFUSED by scripts/browser-session.mjs: 127.0.0.1:3000 is the LIVE instance and a probe may
not POST /api/pages. Point BASE and DATABASE_URL at a disposable copy (docs/TESTING.md).
```

This exists because the rule above was only a paragraph, and a paragraph did not stop it: on
30 October the owner's database was found holding **194 trashed pages** — `Untitled`, `Alpha`,
`Beta`, `Ship the table` in repeating loops, created in batches and swept under the batch id
`cleanup-1793362212300`. The writes went straight into `data/raspberry.sqlite`.

Reads still work, which is what the read-only probes need. When a probe genuinely must write
to live, it says so — `openBrowser({ allowMutations: true })` — and the session prints a
`WARNING mutations are ALLOWED` line, so it appears in the transcript instead of discovering
itself later in the database. `b.blockedWrites()` returns what the guard refused; assert it
is empty at the end of a read-only probe.

A probe that clicks `New page`, types a title and presses Enter now fails loudly on the live
instance instead of quietly leaving a page behind. That is the intended outcome.

```powershell
node scripts/verify-db-gutter.mjs 1400 900
```

Do not run the old `scripts/scratch/cdp-db-gutter.mjs` to compare. It removes its Chrome profile
only on the happy path — a `setTimeout` before `process.exit`, with no `finally` and no signal
handler — so a crash or a Ctrl+C leaves 200-odd files behind, which is how 292 probes became
14.6 GB. 41 of the scratch probes still spawn their own Chrome this way. They are evidence of
past measurements, not tools: read them, do not run them.

### Proving a write without writing one

`scripts/verify-database-b40.mjs` is the pattern for anything that ends in a request. It
patches `window.fetch` *inside the page* before touching the UI: every non-`GET` call to
`/api/databases*` is recorded and rejected, so the app sees a failed save and the owner's
database keeps its values. The assertion is then the **body the UI built**:

```js
await b.type("Probe page");
await b.key("Enter", { code: "Enter", keyCode: 13 });
const sent = await b.evaluate(`window.__writes.find((w) => /\\/rows$/.test(w.url))`);
b.check("typing a name asks for one page with that title",
  JSON.parse(sent.body).title === "Probe page", sent.body);
```

When a write must **land** to prove an answer — a `409` with a count, and the destructive item
that answers it — it lands on a disposable instance instead: `scripts/run-b40-probe.ps1` copies
the project to `artifacts/qa-run/`, points it at its own `data/qa.sqlite`, seeds it with
`scripts/seed-qa.mjs`, runs the probe at 1400 and 390, and stops the server. `window.__allow`
gates the one request that is meant to succeed.

Three things that probe cost, so they are not paid twice:

- **The copy must be the project directory.** `next dev` resolves its project from its working
  directory; starting it through a wrapper while the probe looked for another tree's page
  produced "No pages yet / Loading…" and looked like a broken feature. Invoke `next` directly
  from the copy.
- **Never delete a copy that contains a `node_modules` junction** with `Remove-Item -Recurse`:
  it can follow the link. `cmd /c rmdir` the junction first.
- **A refusal is not a failure.** The probe's first run opened the *title* column's menu, found
  `Change type` disabled, and reported a broken feature. A disabled item, or a missing second
  column, is a `SKIP` with its reason printed.

### Proving a drag

`scripts/verify-db-option-reorder.mjs` is the worked example (the tag menu's reorder grip).
`b.drag(from, to)` completes the whole gesture, which is right for "does dragging work" and
useless for everything else, because the interesting state only exists *between* press and
release. Four things it does instead:

- **Dispatch the three phases by hand** — `Input.dispatchMouseEvent` `mouseMoved`, then
  `mousePressed`, then `mouseMoved` steps (each with `buttons: 1`), then `mouseReleased` — and
  read the DOM in the middle. That is the only way to see the drop line.
- **Hit-test the handle's own rectangle before pressing it.** A press that lands on the row
  instead of the grip still looks like a drag from the outside, and then the assertion passes
  for the wrong reason. `elementFromPoint` on the grip's centre, asserting it resolves to the
  grip, costs one call.
- **Assert that a press that never moves changes nothing** — in the DOM *and* in the stored
  config. That is the difference between a click and a drag, and it is the half nobody writes.
- **Read the order back from the server.** A list that redrew itself in the new order proves
  that React re-rendered, not that the property was reordered; the write is the claim.

Two traps particular to drags in a popover: pointer capture means the other rows never fire
`pointerenter`, so hit-testing has to be `elementFromPoint` + `closest('[data-option-id]')` —
and a click inside a *submenu* closes the whole menu (the submenu is portalled outside the
panel that dismisses itself), so an assertion immediately after one must wait on the stored
state, not on the drawn list that just unmounted.

### An upload is proved by the bytes, and a drag by who handled it

`scripts/verify-db-files.mjs` is the worked example. Three techniques, each of which replaced a
weaker check that would have passed on a broken feature:

- **Drive the real `<input type=file>`.** `DOM.setFileInputFiles` with the node's `objectId` is the
  browser's own file chooser: it sets `input.files` and fires `input` and `change`, which is the
  event the panel listens for. Calling the handler with a hand-made `FileList` tests the handler and
  skips the wiring; that is the difference between "the panel can upload" and "a chosen file reaches
  the panel". Files to upload are written into a `mkdtemp` directory and removed in `finally`, not
  committed as fixtures.
- **Then fetch the bytes back.** "The cell shows a row" is true of a reference to nothing — which is
  the exact bug this feature removed. The claim is three parts: the stored value is
  `{id,name,mime,size}` (no `url`, which is derived), `GET /api/files/:id` is `200`, and its body is
  **byte-identical** to what was sent.
- **A batch must contain a file that fails.** "Nothing is lost when an upload fails" is a claim about
  a batch, so the probe sends two files where one is empty and asserts the other still landed *and*
  that the refusal is named in the surface. One file at a time can only tell you whether the happy
  path works.

And one boundary, stated rather than implied: an OS drag cannot be synthesised — the input domain has
no such event. A real `DataTransfer` holding a real `File`, dispatched as `dragover` and `drop`, runs
every line of *our* handlers (the `types` check, `preventDefault`, the batch) and none of the
browser's. Assert what that covers; do not call it "drag and drop works".


### Assert pixels, not class names

The gutter harness states the principle better than any summary: *"Asserting
`x.a === x.b` is the whole test; asserting 'the gutter has width 0' would pass while a
stray padding pushed the grid right."*

The same harness proves reuse by comparing the row's grip against the block's own anchor
**on the same page** — element structure, glyph path data, the 39×30 split, and the
plus-then-grip order. A copy can match any one of those; matching all of them at once is
what "reused the component" means.

### When the question is "is this opaque", ask the compositor

`b.pixel(x, y)` returns the colour actually painted at a viewport coordinate — the same space
`getBoundingClientRect()` speaks — by capturing a 1×1 screenshot and decoding it. It exists
because "does this box stop what is behind it" cannot be answered by `getComputedStyle`: an
element with `background-color: rgba(255,255,255,0.07)` reports exactly that, and the URL mark's
hover state was transparent for a turn while every style assertion about it passed.

Three things to know before using it:

- **`Page.captureScreenshot`'s `clip` is in page coordinates, not viewport coordinates.** The
  helper adds `window.scrollX/Y` so callers can pass rectangles as measured; that conversion was
  established by experiment (a red block at document y=1000 with the window scrolled to 800 is
  sampled at `pixel(x, 1030)` and *not* at `pixel(x, 230)`), and it belongs in one place.
- **Compare against a patch, not against text.** Put a saturated block behind the control, in the
  control's own box, and sample the same interior pixels with and without it. Text has antialiased
  edges and a fill test against a moving edge is a coin toss; "does *anything* show through" has
  one right answer. See `occlusion()` in `scripts/verify-db-url.mjs` — it clears the 1px border and
  the centred glyph on purpose.
- **A screenshot has no idea what a colour means, so make the fixture's colours mean something.**
  `b.pixel` gives an RGB triple; the place-card probe's tile fixture encodes each square's `z/x/y`
  into it, so `rgb(48,128,40)` is a *statement* — square `5,15` is where it should be — rather than
  "darkish". Compare that with the same file's first attempt, which asserted a filter was "on"
  because `getComputedStyle` said so while the map was a rectangle of noise.

A screenshot goes with the number (`url-mark-opaque-<width>.png`): a caption that says "0/255" and
an image showing red through the box means the number measured the wrong pixel.

### A step that is wired in but never runs is worse than no step

`run-dates-probe.ps1` ends with `verify-text-clip.mjs` so the descender measurement covers the
date cell's ellipsis. That probe asserts the tag chip **by name** — its own reason for
existing — and the dates fixture had no tag column, so the step sat in `waitFor` until it timed
out. The runner exited 1 after the real probe had passed 34/34, every time, and the last line
of the output looked like a green run because it was read through `Select-Object -Last 20`.

Two rules came out of it:

- **A fixture has to satisfy every probe its runner calls.** If a step's precondition is not on
  the page, either seed it (`seed-qa-dates.mjs` now carries a Select column with one tag) or do
  not call the step. A step that always fails is noise a reader learns to skip.
- **Read a runner's exit code, not its last lines.** `$LASTEXITCODE` after each probe is the
  only thing that says whether the thing you just added worked; the tail of a redirected log is
  where a failure hides.

The measurement then earned its keep immediately: the page title's line box clipped its own
descenders by 2.4px at 40px, on every page in the app, and nothing had ever measured it.

## Staleness, before believing a 500

The process serving the request is not the source tree. `src/server/runtime.ts` parks the database
handle and the two service wrappers on `globalThis`; the wrappers are keyed on the class that built
them, so a reload picks up a new method or a new schema without a restart. **A migration is not:
it runs when the connection opens**, and so does anything you change inside `openDatabase` — those
still need `Start-Raspberry.cmd` restarted.

The general rule, which cost the owner a bug to learn: **a probe starts a new process, so a green
probe proves the source and says nothing about the process he is looking at.** When a fix "does not
work" while every probe passes, ask the *running server*, not the copy. A `PATCH` carrying a value
that is invalid in every version of the schema is safe to send (`patchView` validates the config
before its `UPDATE`, so it writes nothing) and its error message quotes the validator's own
vocabulary — if that list does not contain the value you just added, the process is running older
code than the disk.

## A claim about ordered writes must wait for the *last* one

The tag dropdown's `+` makes two requests in order — the option into the property's config, then
the cell value that points at it — because the server's `coerce` empties a cell naming an option
the config does not have yet.

A probe that waits for the first write and then reads the cells is sampling a state that is
*usually* already true. `verify-db-status-groups.mjs` did exactly that: green for a whole run at
1400×900, red at 390×844, where the read landed in the gap between the two `PATCH`es.

The fix is to wait for the claim, not a shorter claim: the predicate becomes "the tag exists **and**
some cell holds it", with the same 8s budget. If the second write were genuinely lost, that times
out and says so. Waiting for the final state is not the same as weakening the assertion — it is
the difference between testing the feature and testing the scheduler.

## A pane must hand the keyboard back

Replacing a surface's body removes the row that had focus, so `document.activeElement` becomes
`<body>`. `onMenuKeys` is bound to the surface element, so from then on no key reaches it: the pane
is pointer-only. Nothing about presence fails — every row is in the DOM and pressable — which is
why `Status groups` shipped keyboard-dead and nobody noticed.

So the probe presses the keyboard, twice in each direction (`verify-db-dates.mjs` §9):

```js
(await focused())           // "date-format" — the row that opened the pane, restored after a pick
await b.key("ArrowDown")    // the surface hears it again… which it cannot do from <body>
await openFormatPane()      // …and the way in focuses the way out
(await focused())           // "Back to calendar"
```

Note what this harness *cannot* do: `b.key("Enter")` sends a `rawKeyDown` with no `text`, and
Chrome does not activate a focused button from that. `ArrowDown` is the honest proof that the
surface is receiving keys again — do not read a failed Enter as a broken button.

## A probe that dies must not report OK

`verify-database-b40.mjs` caught its own exception, printed `probe failed: …`, and then called
`report()` with whatever checks had run so far. A run that failed at the *first* step therefore
printed `OK: 0/0 passed` and exited **0**. Two of its steps had been dead for turns and every
green summary in that window counted them as passing.

A throw is a failure of the probe, and it is now recorded as one:

```js
} catch (error) {
  b.check("the probe ran to the end without throwing", false, String(error?.message ?? error));
  await b.report();
}
```

The same three lines are in `verify-db-checkbox.mjs`. When you write a probe, ask what its output
says when the app never loads — if the answer is "OK", the probe is the thing being tested.

Two consequences are worth knowing, because they were both real:

- **`0/0 passed` is an alarm, not a pass.** Nine assertions that ran and vanished are not nine
  assertions that passed.
- **A cold `next dev` is not a broken app.** The first browser navigation to a page compiles that
  page's client bundle on demand; `/api/health` only proves the health route is compiled. The
  B40 probe's first `waitFor: the table` allowed 20s, which was outrun at 1400 and read as a
  missing table. It allows a minute now, and `run-b40-probe.ps1` fetches the page route before the
  first width — neither costs a warm run anything.

## Running a probe against the bug it describes

A probe written after a fix passes, which proves it runs, not that it catches anything.
`run-row-open-probe.ps1 -Before` copies the project, rewrites the copy back to the shape the bug
had (the `<tr onDoubleClick>`, the `db-row-open` class, the `cursor: pointer` rule), and runs the
**same** probe file against it — then fails the run if the probe passes there. Today it reports
`3/18` on the old tree and `18/18` on this one. Any runner that can rebuild its own bug should
carry a switch like it.

Two traps, both of which cost a run:

- **`Get-Content` / `Set-Content` in PowerShell 5.1 are ANSI**, so rewriting a source file with
  them mangles the em dashes and Turbopack answers `invalid utf-8 sequence` — a compile failure
  that reads like a probe failure. Use `[System.IO.File]::ReadAllText/WriteAllText` with an
  explicit UTF-8 encoding. Scripts themselves must be **ASCII**: a `.ps1` is read as ANSI, and a
  `”` byte inside a double-quoted string terminates it, giving a syntax error reported on a
  later line than the one that caused it.
- **A probe that throws mid-run hides its remaining claims.** Guard each press on whether the
  thing it means to press is still there (`pressable(label, point)`), so a navigating tree
  produces the whole list of failures instead of one stack trace.

And for gestures: **two `b.mouse()` calls are not a double press.** Blink dispatches `dblclick`
from the second press's `clickCount`, so use `b.doubleMouse(x, y)`. A probe that "tests a
double-click handler" with two counted-as-one presses never reaches the handler at all.

## Probing something that talks to the network

The Place cell searches a geocoder, and a probe that called the real one would be three bad things
at once: non-deterministic, dependent on the internet being up, and a stream of the words it types
going to somebody else's server on every run. So the probe **starts its own provider**:

```js
// scripts/verify-db-places.mjs
const fixture = createServer((request, response) => { /* fixed GeoJSON per query, and it logs
  what it was asked */ });
await new Promise((r) => fixture.listen(3117, "127.0.0.1", r));
```

and the runner boots the disposable copy with `RASPBERRY_PLACES_URL=http://127.0.0.1:3117/`. Every
claim is then about *this app's* path — debounce, route, mapper, list, commit — and none is about a
provider's ranking.

The fixture's log is what makes two otherwise-unprovable claims measurable:

- **"One request, not one per letter."** `b.type("Eiffel")` sends a real key event per character;
  the fixture must have been asked exactly once, with the whole word.
- **"The request went from the server, not from the browser."** The fixture answers with the
  `user-agent` it saw. `Raspberry/0.1 …` means our route made the call; anything containing
  `Chrome` means the browser did, and the route is being bypassed.

And the failure path is testable because the probe owns the server: `fixture.close()` mid-run, type
an address, and the surface must say *"The place service could not be reached"* while still
offering to store what was typed. An app that silently renders that as "no results" would pass
every other check in the file.

Two more rules this turn produced, both in `DECISIONS.md`:

- **A wait names the state, not the element it is drawn with.** Waiting for "a `.db-place-note`
  exists" returned on the idle panel, which draws that paragraph before any search has run.
  `until(state => state.note === "Nothing found…", label)` prints the whole last surface on a
  timeout, so a failure says what was actually on screen.
- **Two widths, one process.** The server caches a query for ten minutes, so the 390 run must ask a
  question the 1400 run did not — otherwise "one request" measures the cache and reports `0` as a
  failure of the debounce.

### Two providers is two fixtures, and a tile fixture can be a measuring instrument

The picked-place card needs a geocoder *and* a tile server, so `run-place-map-probe.ps1` boots the
copy with `RASPBERRY_PLACES_URL` and `RASPBERRY_TILES_URL` pointing at two loopback servers the
probe starts itself (:3118 and :3119). The tile one is worth more than "a stand-in for
OpenStreetMap":

- **It encodes each square's own `z/x/y` in its pixels** — `R = 8 + 8·(x mod 30)`, `G = 8 + 8·(y mod
  30)`. A screenshot then *names* the square it landed on, so "the tiles are in the right places"
  becomes a measurement, and a square drawn one position off fails by name. Steps of 8 leave room
  for a channel being off by one, which colour management in a headless browser will do now and
  then.
- **Sample inside the visible part of a square.** The box is 226×150 and a square is 256, so a
  square's centre is often off the edge of the map; the first version of this sampled there and read
  the page *behind* the card, reporting four greys. Its second version read the attribution label
  and reported `rgb(44,130,36)` — a number that belonged to neither square. Three points per square,
  two of which must agree, is the version that survived both.
- **A square that failed is a hole, so the switch is testable without restarting.** With the
  card open, `Fetch.enable` + a handler that answers `503 {"error":{"code":"tiles_off"}}` produces
  exactly the bytes `RASPBERRY_TILES_URL=off` produces, and the card must say *"Map tiles are
  switched off"* rather than *"The map could not be drawn"*. `b.onEvent(fn)` is there for protocols
  that are a conversation; pass `null` to remove it.

### The negative claim: did anything leave the machine?

`b.requests(match, from)` returns every request the page made, in order, from CDP's
`Network.requestWillBeSent` — and it is the only way to answer this one:

> *"the map's squares come through our own route, not from OpenStreetMap"*

`<img src="https://tile.openstreetmap.org/16/…">` and `<img src="/api/places/tile?z=16&…">` draw the
same pixels. Every DOM assertion in the file passes on both. One of them puts the address somebody
just picked into a stranger's access log four times per cell. So the probe asserts **every request
the page made stayed on this machine** (`new URL(entry.url).host === BASE's host`), plus the
positive half — that `/api/places/tile` *was* asked. A run that later points the map at a tile
server fails a check named exactly that, and it is the only check in the repository that would.

### An `href` is asserted whole, because a prefix passes on the wrong link

The card's corner arrow is one string, and the interesting failure is not "it broke" but "it points
somewhere plausible and wrong". `mapLink` returns
`https://www.google.com/maps/search/?api=1&query=lat,lng`; a check written as
`/^https:\/\/www\.google\.com\/maps/` passes on `?query=Eiffel%20Tower` **and** on
`?query=Rašica+53`, both of which hand Google a sentence to re-geocode into a pin that can land
somewhere other than the one the card just drew. So the probe compares the `href` as a whole string
and asserts that no `%20`, no `+` and not the place's own name appear in it, and
`tests/geo-mercator.test.ts` does the same on the function. Putting the old OpenStreetMap URL back
fails **exactly one named check, at both widths** — which is how we know the assertion is carrying
the decision and not just describing it.

### A wait's timeout argument is not a label

`softUntil(predicate, timeoutMs)` is the wait for **the thing being tested** — it returns the last
surface instead of throwing, so a pre-fix run prints named failures rather than dying at step one.
The first version of the card probe passed a label as its second argument:

```js
await softUntil(state => state.isCard === true, "the map card for a stored place");  // ← this throws now
```

`Math.ceil("the map card…" / 200)` is `NaN`, so the loop ran **zero times** and returned `null`. The
next four checks reported `card undefined` — indistinguishable from "the feature is missing" — and
the `-Before` run blamed the app for 23 seconds. `softUntil` now throws on a non-number, because a
silent zero-iteration wait is the same class of bug as `blockedWrites()` on an unguarded session:
an answer that was never computed, printed in the shape of an answer.

### A hover is a `mouseMoved`, and the wait is longer than the feature's own delay

The peek appears 300ms after the pointer rests on a row — deliberately, so sweeping the pointer down
a list of attachments does not flash eight pictures. A probe that checks immediately measures the
*delay*, not the feature, and would fail on a correct build. So the probe sends a real
`Input.dispatchMouseEvent`/`mouseMoved` (not a `mouseover` dispatched from page script — Chrome runs
its own hit-testing for the former) and then sleeps **520ms**: longer than the feature, not equal to
it. The `-Before` run proves the other half — with `<FilePeek>` rendered as `{null}` those same
checks fail by name, so the wait is not hiding a broken feature behind a long sleep. It fails **7 of
the 10** new checks and no more: *a document gets no preview*, *leaving the list takes it away* and
*it goes when the pointer does* pass there too, because a tree that never draws a box trivially
satisfies "no box". An absence assertion is worth writing and worth knowing the shape of — it can
never be the check that proves a feature exists.

Two things that are *not* assertions worth making, and this is where a hover probe usually goes
wrong:

- **The pixel.** Sampling the middle of a preview of a 2×2 test PNG says "there is a colour there",
  which the page behind it would also say. It was written, then deleted. What the probe keeps is the
  `<img>`'s `naturalWidth > 0` — the bytes decoded — plus a screenshot per width for the human, since
  two of the last three turns shipped a UI fault every assertion passed.
- **The mouse path.** `pointer-events: none` on the peek is asserted as a *computed style*, not by
  moving the pointer over it and watching for a blink loop: a blink loop is a timing race, and a
  computed style is the fact that causes it.

### A file's disposition is read from the page, not from the source

The save button's claim is about a response header: the same bytes must arrive as
`Content-Disposition: attachment` carrying the stored name, while the name link stays `inline`. The
probe therefore fetches both URLs **from inside the page** (`fetch` in `Runtime.evaluate`) and reads
`headers.get('content-disposition')`; asserting the anchor's `href` alone would pass on a link that
saves nothing, which is exactly the bug the `<a download>` shortcut would have shipped.

### Fixtures for a ranking must be recorded, not imagined

A ranker tested against rows invented to suit it proves nothing. The fixtures in
`tests/database-place-ranking.test.ts` and in the probe are **what Photon actually answered** on
2026-11-01, with every property field copied from the response — including the row the owner
complained about. Before writing any of it, two facts were checked against the map itself with
Overpass, because they decide whether the fix is even possible. The query was
`nwr["addr:street"~"^Rašica$",i]` inside a bounding box around Velike Lašče
(45.6, 14.3 → 46.1, 14.9), `out center tags`:

- `Rašica 53` returns **two** addresses in Slovenia, 40 and 12a. House 53 is not mapped, so no
  OSM geocoder can return it and a test demanding it would be a test demanding a different provider.
- `Grahovo Brdo 1` is a node tagged `name=Turistična kmetija Mahnič` — which is why the answer was
  right and the label wrong.

Three traps from this turn:

- **One point for eleven places.** Every fixture row defaulted to the same coordinates, so the
  de-duplication key `name@lat,lng` collapsed five real results into one and the probe "passed" on a
  list that had thrown the right answers away. Coordinates are part of the fixture even when the
  ranker does not read them.
- **A regex with no ASCII in it cannot be reviewed.** A combining-mark range typed literally (the
  accents-fold) is invisible in an editor — it renders as a character class with nothing visible
  between the brackets, and looks like a mistake. Write `/\p{M}+/gu` instead. Same for the fixture's
  own folding, which must be able to match the query the probe types (`Rašica`) whichever way it is
  spelled.
- **`-Before` has to rebuild *this* turn's bug.** The place runner's old `-Before` deleted the whole
  Place branch from `cell-editor.tsx` — right for the turn that built the feature, useless for a turn
  about ranking, because it fails for reasons that have nothing to do with ranking. It now neuters
  the ranker instead (provider order kept, every row headed by the place's own name) and scores
  **39/44**, with the five failures printing the owner's complaints verbatim.

### A fixture is only as good as the rows the rule reads

The next turn added a rule — a composed address is anchored to the road, and the settlement most of
that name's roads are in wins — and the **existing fixture could not see it.** It held two district
rows and one road, so "count the roads" and "count everything" gave the same answer, and the rule
would have been shipped untested while every assertion stayed green.

A recorded fixture is not automatically a sufficient one. The question to ask of it is *does it
contain the difference the new rule turns on?* Here the real answer for `q=Rašica` holds **six** roads
— four in Velike Lašče (1315 twice, 1314, 1311) and two in Ljubljana — which is exactly the four-to-two
that decides the postcode, so the fixture was re-recorded from the real response. Where the real
world does not contain the contrast at all, a small hand-built pool is the honest tool: three
Ljubljana districts and one Velike Lašče road is the test that proves roads are counted *instead of*
the administrative rows, and it is not something the provider happened to return.

Then falsify each rule by mutating the source, not by reading it:

| mutation | test that must go red |
|---|---|
| drop the count from the group order | the first row becomes Ljubljana |
| count every addressable row instead of roads only | three districts outvote one road |
| allow a landmark to host a house number | "Eiffel Tower 1", and the neighbours test with it |
| drop `approx` from `coerce` | a composed value comes back a doorstep |

All four were run. A rule with a passing test has been shown to hold; a rule whose test has never
been shown to fail has only been shown to parse.

### When the dependency is somebody else's free service

Photon cut this machine off after about twenty requests in two minutes — 503s, then TCP timeouts for
hours — while `nominatim.openstreetmap.org` and `example.com` kept answering in under a second. Two
consequences for how this gets tested:

- **Check the network before blaming the code.** `scripts/scratch` had a three-line probe comparing
  `photon`, `nominatim` and `example.com`; without it, a blocked provider reads as a broken app.
- **A unit test can cover the manners even when the internet cannot.** The breaker, the single retry,
  the stale answer and the busy/ unavailable split are all proved against a loopback server that
  answers 503 on purpose — no external host involved, deterministic, and it runs in two seconds.

And one rule that only shows up in this situation: **call the live route after a change that touches
a `globalThis` cache.** The suite starts with an empty cache and passed while the running dev server
answered "nothing found" for every query, because it was holding entries from the previous shape of
the file. The tests were green; the app was wrong; a `curl` found it.

## Checking the documentation itself

```powershell
node scripts/check-docs.mjs          # exits non-zero if docs/STATE.md drifted
node scripts/check-docs.mjs --fix    # rewrites the snapshot block
```

Also runs as part of the suite. If you add or remove tests, this tells you to update
`docs/STATE.md` rather than letting it quietly become the next `CHECKLIST.md`.

## Test a language by executing its own help

A parser and a function library have one failure that no DOM assertion can see: the code and the
documentation drift, and the documentation is what a person reads before writing their first
formula. `tests/database-formula.test.ts` closes it by making every documented example a test case:

```js
for (const fn of FUNCTIONS) for (const example of fn.examples) {
  const result = previewFormula(example.code, row, properties, NOW);
  if (example.fails) { assert.notEqual(result.message, null); continue; }
  assert.equal(result.text, example.result);      // "add(2, 3)" must still print "5"
}
```

Two things to keep when extending it. **Examples must be row-independent** unless the test builds the
row (`prop("Name")` is fine; `prop("Due")` needs a row the test owns), so the fixture in that file
carries one of every property type. And **the clock is a parameter**: `previewFormula(expression,
row, properties, now)` takes `now` so `today()` is a fixed day, and a test that reads the real clock
is a test that fails on the one day the offset is zero.

The same rule catches the second kind of drift for free: a function added to the registry appears in
the editor's list, in the search, and in the docs, because all three are generated from it.

## Probing a computed column, where the value and the editor are two different claims

A formula column is the one place where "the cell shows 45" is not evidence that the *column* is
right — the server computes it on read, the cell renders it, and the editor writes the expression.
`scripts/verify-db-formula.mjs` therefore checks them in that order, and each check names the layer
it is proving:

- **the server**: read the cells (`80`, `Total 80`, `No`, `14`, `Empty`), through the table, so the
  read path is what is under test;
- **the editor**: `pre.textContent === textarea.value` — the only assertion that can catch the
  painted layer drifting off the caret;
- **the write**: close the panel and wait for the *cell* to re-read `45`, then read the config back
  from `/api/databases` and assert a second formula that reads the first one changed too;
- **the refusal**: `PATCH` a value straight into the column and assert a 4xx, because `derived` is a
  promise the write path keeps rather than a note in a module.

`-Before` for this one is the honest reproduction of the complaint: revert `applyFormulas` and the
editor branch, and the probe's first nine checks fail with an `<input class="db-cell-input">` printed
from inside the formula cell and an empty value — "it currently does nothing", measured.

## Proving two clients agree, when one browser cannot see the other

Live sync (B56) is the first feature here whose subject is a *relationship*, and every probe in
this repo before it drove one browser. Nothing inside a single page can say whether the other one
would have noticed, so `scripts/verify-live-sync.mjs` opens two: it seeds one page on a disposable
instance, points both clients at it, retitles it on A, and asserts on B.

Three habits from this one are worth copying:

- **"It changed" is not the assertion — "it changed without a reload" is.** A manual reload
  produces the correct DOM and is exactly the bug. `performance.timeOrigin` is stamped when a
  document is created and re-stamped only by a *new* document, so an unchanged value on B is
  proof that the DOM showing the new title is the one B loaded.
- **Count the requests the feature depends on.** `requests("/api/sync")` rising is what separates
  "polling worked" from "the change arrived and we do not know how". The same log is how a probe
  proves a fetch went to our own server rather than a third party's CDN.
- **Drive the second client at the same time as the first writes.** The cheap way to make this
  feature "work" is to adopt every change, which deletes what the other person is typing. So the
  probe types continuously into B while A writes, and asserts B's own text survived *and* that B
  says its copy is behind. That second check is the one that caught a real defect: the notice was
  a `status`, a keystroke rewrote it 200 ms later, and the sampler never once saw it.

`-Before` for this one deletes `src/app/api/sync` from the disposable copy rather than removing
the client call, because the surgery has to leave the copy *compiling* — a probe that fails to
build has proved nothing. Measured: both propagation checks fail at both widths with the old
symptom printed verbatim, `second client still shows "Sync probe …"`.

Two browser instances also mean two dev-server compiles and ~15 s of waiting per resolution. That
is the cost of the only assertion that can fail.
## Definition of done

- `tsc --noEmit` clean.
- Full suite green, not the subset you were iterating on.
- If it is UI: driven in a real browser at 1400 / 900 / 390, asserted by measurement.
- If it is a write: the request body asserted, the owner's database unmodified.
- `docs/STATE.md` updated if anything about the project's state changed.
- Say what you actually verified and what you did not. "Tests pass" is not the same claim
  as "the browser renders it".
