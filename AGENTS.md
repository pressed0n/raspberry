# Raspberry — rules for agents

Read this file, then **two documents, in this order**:

1. **`docs/STATE.md`** — what is done, what is next, what is parked, what is broken. It is
   the only authority on the project's state. If anything else disagrees, this file is
   stale and `docs/STATE.md` is right.
2. **`docs/MAP.md`** — where everything lives, and the table of shared controls you must
   reuse instead of redrawing.

Two more, when the question is "why" or "how do I prove it":
`docs/DECISIONS.md` (why the code is like this — paid for with bugs) and
`docs/TESTING.md` (how to verify without destroying anything).

`docs/ARCHIVE/` is history. Do not treat it as a to-do list; the old backlog's "Active
to-do" section was 11/14 already-shipped work.

---

## Two hard rules

These are not style preferences. Both were broken, and both cost the owner something.

### 1. Never delete the owner's pages

Do not trash, purge, soft-delete, or "clean up" pages in `data/raspberry.sqlite` — not as
tidy-up after a test run, not because they look like fixtures, not because they are empty
or "Untitled".

> *"you trashed a bunch of my pages. Not cool."*

Test read-only. To prove a write, intercept the request in CDP and assert the body the UI
built. If a test must write, delete only the exact ids it created in that same run. Never
delete by pattern, date, title or emptiness. Full procedure: `docs/TESTING.md`.

### 2. Reuse before you write

Before drawing any control a document editor would plausibly already have — a grip, a
plus, a checkbox, a menu, an icon, a page glyph, a colour swatch, a dialog — **search for
the existing one and import it.** If it lives somewhere awkward, move it to a shared file
and import it from both places. Do **not** reach for `lucide-react` because it is one
import away.

> *"You did not re-use the 6 dot grip and plus components that are already established …
> Why are you constantly redoing them instead of using what is already established."*

The operational table is `docs/MAP.md` § "Shared controls". The reasoning — including why
reusing the glyph but hand-rolling the button is the same mistake one level down, and why
order matters (plus before grip) — is `docs/DECISIONS.md`.

### The guard is a test, not a note

> A note in a document is only followed by whoever read it that session; a failing test is
> read by everyone.

`tests/frame-anchor.test.ts` enforces rule 2. `tests/docs-freshness.test.ts` enforces
`docs/STATE.md`. When you learn something that must not be re-broken, add the assertion,
not the paragraph.

## Before believing a 500

`src/server/runtime.ts` parks the database handle and the two service **instances** on
**`globalThis`** — deliberately outside the module graph, so they survive a hot reload. The instance
is what goes stale: editing a service class re-evaluates the class while the stored instance keeps
running the old one, so a method you added a minute ago answers `is not a function` and the route
returns **500**, or — worse — a validator you widened rejects the new value with a message written by
code that no longer exists on disk. The second one shipped: the UI offered a sort direction and the
server answered `Invalid option: expected one of "ascending"|"descending"`, because the UI had
reloaded and the parked instance had not.

The wrappers are now tagged with the class that built them and are rebuilt when a reload replaces
that class, so a new method or a widened schema is live on the next request. **What still needs
`Start-Raspberry.cmd` restarted is a migration** (it runs when the connection opens) and anything
you change inside `openDatabase`.

And the rule behind it, which is the part that generalises: **a probe starts a new process, so a
green probe proves the source and nothing about the process the owner is looking at.** When he says
a fix did not work and every probe passed, ask the running server — `docs/TESTING.md` § "Staleness,
before believing a 500" has the message-quotes-the-validator trick that answers it in one request.

## Running things

Node and pnpm are **not on PATH**. Normally you do not touch them: `Start-Raspberry.cmd`
finds Node itself and is the only supported way to run the app. If you need the CLI directly,
prefer the vendored toolchain:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;" + $env:Path
node node_modules\typescript\bin\tsc --noEmit
node node_modules\tsx\dist\cli.mjs --test tests/*.test.ts
```

`.tools/` is gitignored, so on a fresh clone that first line is a lie — check
`node --version` (24+) first, or just use the launcher.

`scripts/` holds thirteen real tools, one line each in `docs/MAP.md` § 7. `scripts/scratch/`
holds gitignored one-off probes from past sessions — useful as evidence, not part of the app;
write new browser probes against the tracked `scripts/browser-session.mjs`, which removes its
Chrome profile on exit.

**Scope your file searches.** A recursive listing from the repo root is ~40 k files through
`node_modules/` and takes 15 s; an unscoped probe once put 371 k files (14.6 GB of leaked
Chrome profiles) in `artifacts/` and made the same command time out. Search `src`, `tests`,
`docs`.

---

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
