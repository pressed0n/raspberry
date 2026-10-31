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
`seed-qa-groups.mjs`) and `:3104` / `run-dates-probe.ps1` (the date picker, seeded by
`seed-qa-dates.mjs`). Each re-seeds **per resolution**, because those probes mutate a property's
config — a shared seed would let the second pass read the first pass's leftovers.
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
spawn, the CDP transport, `waitFor`, real mouse/drag/key input, `shot()`, and
`check()`/`report()` (which prints the score and exits non-zero), so a probe is the
assertions and nothing else:

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

### Assert pixels, not class names

The gutter harness states the principle better than any summary: *"Asserting
`x.a === x.b` is the whole test; asserting 'the gutter has width 0' would pass while a
stray padding pushed the grid right."*

The same harness proves reuse by comparing the row's grip against the block's own anchor
**on the same page** — element structure, glyph path data, the 39×30 split, and the
plus-then-grip order. A copy can match any one of those; matching all of them at once is
what "reused the component" means.

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

## Checking the documentation itself

```powershell
node scripts/check-docs.mjs          # exits non-zero if docs/STATE.md drifted
node scripts/check-docs.mjs --fix    # rewrites the snapshot block
```

Also runs as part of the suite. If you add or remove tests, this tells you to update
`docs/STATE.md` rather than letting it quietly become the next `CHECKLIST.md`.

## Definition of done

- `tsc --noEmit` clean.
- Full suite green, not the subset you were iterating on.
- If it is UI: driven in a real browser at 1400 / 900 / 390, asserted by measurement.
- If it is a write: the request body asserted, the owner's database unmodified.
- `docs/STATE.md` updated if anything about the project's state changed.
- Say what you actually verified and what you did not. "Tests pass" is not the same claim
  as "the browser renders it".
