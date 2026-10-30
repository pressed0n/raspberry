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
  time out. `cdp-session.mjs` deletes the profile on `close()`, on throw, and on Ctrl+C;
  `scripts/check-docs.mjs` fails if one is left behind. The 28 scratch probes predate this and
  still leak.
- Navigate to `http://127.0.0.1:3000/#<page-id>` — the hash **is** the deep link.
- Drive with real input events (`Input.dispatchMouseEvent`), not `element.click()`.
- Assert with `elementFromPoint` and measured rects; screenshot at the widths that matter.
- Run at **1400, 900 and 390** pixels. Layout compromises are width-dependent: below 860px
  the database gutter deliberately becomes a real first column, and the assertion flips
  with it.

```powershell
node scripts/verify-db-gutter.mjs 1400 900            # new, tracked-style probe
node scripts/scratch/cdp-db-gutter.mjs 1400 900    # the historical one
```

### Assert pixels, not class names

The gutter harness states the principle better than any summary: *"Asserting
`x.a === x.b` is the whole test; asserting 'the gutter has width 0' would pass while a
stray padding pushed the grid right."*

The same harness proves reuse by comparing the row's grip against the block's own anchor
**on the same page** — element structure, glyph path data, the 39×30 split, and the
plus-then-grip order. A copy can match any one of those; matching all of them at once is
what "reused the component" means.

## The restart rule, before believing a 500

`src/server/runtime.ts` memoises service instances on the module. Adding a server method
and reloading hot-reloads the class but keeps the old instance, so the new method answers
`is not a function` and the route returns **500** — indistinguishable from a real bug.

**Restart `Start-Raspberry.cmd` after adding a server method, before diagnosing any 500.**

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
